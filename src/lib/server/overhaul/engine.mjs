import {authorTools} from './authorTools.mjs';
import {projectToolBodies} from './contextProjection.mjs';
import {GmResources,homerSourceRoot,validateResourceSnapshot} from './resources.mjs';
import {assembleGmPrompt,validatePromptSnapshot} from './gmPrompt.mjs';
import {pinCompactionResource,prepareDurableConversation,readAcceptedTurn} from './contextCompaction.mjs';
import {createSharedAgent} from './agentLoop.mjs';
import {RuntimeLease} from './runtimeLease.mjs';
import {withRunFence} from './runFence.mjs';
import {campaignContext} from './context.mjs';
import {MemWeaveAdapter} from './memweave.mjs';
import {createAssistantMessageEventStream,validateToolArguments} from '@earendil-works/pi-ai';
import {decisionCategories,groundedDecision} from './decisions.mjs';
export {decisionCategories} from './decisions.mjs';
import {prepareNarration,acceptCompletedNarration,stageEntity} from './narration.mjs';
import {Type} from 'typebox';
import {z} from 'zod';
import {randomInt} from 'node:crypto';
import {hash,StoreError} from './store.mjs';

const gm={role:'gm'};
const inputSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/),action:z.enum(['treat','hold','conflict','question','roll','story','author']),text:z.string().max(2000).default(''),actionType:z.enum(['do','say','think','story','pov','free','ooc']).optional()}).strict();
const zeroUsage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const model={id:'offline-fixture',name:'Offline qualification fixture',api:'openai-completions',provider:'fixture',baseUrl:'disabled:',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:4096};
const active=new Map();
// MemWeave is identified; its optional reviewed runtime stays disabled.
export class LocalMemoryAdapter {constructor(store){this.store=store;this.name='Local Markdown search (MemWeave unconfigured)';}async recall(query,authority){return this.store.search(query,authority,{limit:12});}}
export async function actorDecision(store,actorId,question){
  const authority={role:'npc',actorId}, actor=await store.read(actorId,authority);
  const memory=await new LocalMemoryAdapter(store).recall(question,authority);
  const grounded=actorId==='mira'&&question.trim().toLowerCase()==='healer'&&memory.matches.some(m=>m.id==='evt_treatment');
  return {actorId,question,options:grounded?[{id:'cooperate',intent:'Accept help while protecting the grain road',grounds:[...memory.matches.filter(m=>m.text.includes('cleans and binds')).slice(0,1).map(m=>({path:m.path,line:m.line,lineKind:m.lineKind,hash:m.hash}))]},{id:'bargain',intent:'Ask what is owed before committing',grounds:[{path:actor.path,hash:actor.hash,section:'Goals'}]},{id:'hold',intent:'Wait for more information',grounds:[]}]:[{id:'hold',intent:'Wait for more information',grounds:[]}],selected:grounded?'cooperate':'hold',knowledge:actor.record.data.knowledge,relationships:actor.record.data.relationships,goals:actor.record.data.goals,consequence:'Intent only; no guaranteed outcome',transport:'offline-fixture',catalog:decisionCategories};
}
export function publicRun(run){if(!run)return null;const {messages,toolResults,narrationDraft,entityDrafts,ownerToken,promptSeed,promptSnapshot,resourceSnapshot,initialPromptMessages,compactionResource,...rest}=run;return rest;}
export class FixtureEngine {
  constructor(store,{fault,delayMs=160,sandbox,transport,memory,resources,assistantResources,authoring,agentWorkspace,leaseOptions}={}){this.authoring=authoring;this.assistantResources=assistantResources;this.agentWorkspace=agentWorkspace;this.resources=resources;this.leases=new RuntimeLease(store,leaseOptions);this.transport=transport;this.sandbox=sandbox;this.store=store;this.memory=memory||new MemWeaveAdapter(store);this.fault=fault;this.delayMs=delayMs;}
  async gmResources(){if(!this.resources)this.resources=await new GmResources(homerSourceRoot()).init();return this.resources;}
  async authorResources(){if(!this.assistantResources)this.assistantResources=await new GmResources((await this.gmResources()).root,{role:'assistant'}).init();return this.assistantResources;}
  async start(input){const request=inputSchema.parse(input);if(['story','author'].includes(request.action)&&(!request.text.trim()||!this.transport))throw new StoreError('PROVIDER_DISABLED','A nonempty story action and injected transport are required.');
    if(!active.has(this.store.root))await this.leases.recoverInterrupted();const prior=await this.store.loadRun(request.id);
    if(prior&&prior.fingerprint!==hash(request))throw new StoreError('OPERATION_CONFLICT','Run ID belongs to a different turn.');
    const current=active.get(this.store.root);if(current){if(current.run.id===request.id)return {...publicRun(current.run),replayed:true};throw new StoreError('BUSY','Finish or stop the active story turn first.');}
    if(['completed','cancelled'].includes(prior?.status))return {...publicRun(prior),replayed:true};
    if((await this.store.runs()).some(r=>r.id!==request.id&&r.pendingQuestion&&!r.pendingQuestion.answer&&!r.pendingQuestion.cancelled))throw new StoreError('QUESTION_PENDING','Answer or dismiss the pending story question first.');
    if(prior?.pendingQuestion&&!prior.pendingQuestion.answer)throw new StoreError('ANSWER_REQUIRED','Answer the saved question before resuming.');
    const run=prior||{id:request.id,request,fingerprint:hash(request),status:'running',transport:['story','author'].includes(request.action)?this.transport.name:'offline-fixture',memoryAdapter:this.memory.name,plotDirector:false,paidCalls:0,messages:[],toolResults:{},activity:[],requests:0,toolCalls:0,text:'',at:new Date().toISOString()};
    run.recoverCancelledTools||=Boolean(run.stopRequested);delete run.streamingText;run.status='running';run.error=null;delete run.stopRequested;
    if(active.has(this.store.root))throw new StoreError('BUSY','Another story turn just started.');
    const task={run,agent:null,controller:new AbortController()};active.set(this.store.root,task);
    let claim;try{claim=await this.leases.acquire(run.id);run.ownerPid=process.pid;run.ownerToken=claim.token;if(['story','author'].includes(request.action)){const owner=request.action==='author'?await this.authorResources():await this.gmResources();if(!run.resourceSnapshot){run.resourceSnapshot=await owner.current();if(!run.resourceSnapshot.config.enabled)throw new StoreError(request.action==='author'?'AGENT_DISABLED':'GM_DISABLED','The saved '+run.resourceSnapshot.config.id+' resource configuration is disabled.');}else validateResourceSnapshot(run.resourceSnapshot);run.resourceRevision=run.resourceSnapshot.revision;run.compactionResource||=await pinCompactionResource(owner);if(request.action==='author')run.agentPurpose='author';}await withRunFence({root:this.store.root,runId:run.id,check:claim.check},()=>this.store.saveRun(run));}catch(error){try{await claim?.release();}finally{active.delete(this.store.root);}throw error;}
    task.promise=withRunFence({root:this.store.root,runId:run.id,check:claim.check},async()=>{
      claim.startHeartbeat(error=>{run.stopRequested=true;run.error=error.message;task.controller?.abort();task.agent?.abort();});
      try{return await this.execute(run,task);}catch(error){if(error.code==='RUNTIME_FENCED')throw error;run.status='paused';run.error=error.message;delete run.streamingText;delete run.streamSavedAt;await this.store.saveRun(run);return run;}
      finally{claim.stopHeartbeat();try{await claim.release();}finally{if(active.get(this.store.root)===task)active.delete(this.store.root);}}
    });
    // Persistent failed/paused status is delivered through the normal run read endpoint.
    task.promise.catch(()=>{});return publicRun(run);
  }
  async stop(runId){const task=active.get(this.store.root);if(task?.run.id===runId){task.run.stopRequested=true;await this.leases.requestStop(runId);task.controller?.abort();task.agent?.abort();await this.agentWorkspace?.cancelChildren(runId);await this.authoring?.cancelIfPresent(runId);await task.promise;}else{await this.leases.requestStop(runId);await this.leases.recoverInterrupted();await this.store.serial(async()=>{const saved=await this.store.loadRun(runId);if(saved?.request?.action==='author'&&saved.status==='paused'){saved.stopRequested=true;saved.status='cancelled';if(saved.pendingQuestion&&!saved.pendingQuestion.answer)saved.pendingQuestion.cancelled=true;await this.store.saveRun(saved);}});await this.agentWorkspace?.cancelChildren(runId);await this.authoring?.cancelIfPresent(runId);}return publicRun(await this.store.loadRun(runId));}
  async wait(runId){const task=active.get(this.store.root);if(task?.run.id===runId)await task.promise;return this.store.loadRun(runId);}
  async answer(runId,choice){
    const request=await this.store.serial(async()=>{
      const run=await this.store.loadRun(runId);if(!run?.pendingQuestion||run.pendingQuestion.cancelled||typeof choice!=='string'||!choice.trim()||choice.length>2000||!['story','author'].includes(run.request.action)&&!run.pendingQuestion.options.includes(choice))throw new StoreError('ANSWER_INVALID','Provide a bounded answer to the saved question.');
      if(run.pendingQuestion.answer){if(run.pendingQuestion.answer!==choice)throw new StoreError('OPERATION_CONFLICT','This question already has a different accepted answer.');return run.request;}
      if(active.has(this.store.root)||this.leases.live(await this.store.loadRun('campaign_runtime_owner')))throw new StoreError('BUSY','The story turn is still active.');
      run.pendingQuestion.answer=choice;run.messages.push({role:'user',content:`Author selected intent: ${choice}. Outcomes are still unresolved.`,timestamp:Date.now()});await this.store.saveRun(run);return run.request;
    });return this.start(request);
  }
  async dismiss(runId){const result=await this.store.serial(async()=>{if(active.has(this.store.root)||this.leases.live(await this.store.loadRun('campaign_runtime_owner')))throw new StoreError('BUSY','Stop the active turn before dismissing its question.');const run=await this.store.loadRun(runId);if(!run?.pendingQuestion||run.pendingQuestion.answer)throw new StoreError('ANSWER_INVALID','No unanswered question to dismiss.');run.pendingQuestion.cancelled=true;run.status='cancelled';run.activity.push({kind:'question',state:'dismissed by author'});await this.store.saveRun(run);return publicRun(run);});await this.authoring?.cancelIfPresent(runId);return result;}
  async execute(run,task){
    const request=run.request,isModel=['story','author'].includes(request.action);
    const context=await campaignContext(this.store,gm);run.toolPolicy=context.campaign?.toolPolicy;
    const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],details:value});
    let definitions=[
      {name:'read_record',description:'Read one record inside this story sandbox.',parameters:Type.Object({id:Type.String()}),perform:args=>this.store.read(args.id,gm)},
      {name:'recall',description:'Literal, bounded search over this story Markdown.',parameters:Type.Object({query:Type.String()}),perform:args=>this.memory.recall(args.query,gm)},
      {name:'npc_decision',description:'Ask one NPC through its isolated knowledge/goals/relationships packet. Intent never guarantees an outcome; hold is valid.',parameters:Type.Object({actorId:Type.String(),question:Type.String()},{additionalProperties:false}),perform:(args,callId,signal)=>request.action==='story'?groundedDecision(this.store,{...args,...(context.campaign?.appraisalPolicy?.enabled&&!['think','ooc','pov'].includes(request.actionType)&&context.campaign?.playerId&&context.campaign?.sceneLocationId?{observedAction:{actorId:context.campaign.playerId,text:request.text,actionType:request.actionType||'story'}}:{}),operationId:'decision_'+hash(run.id+callId).slice(0,40)},this.transport,{signal,memory:this.memory,scopeId:run.id,beforeRequest:async receipt=>{if(receipt.stage==='prepared'){if(++run.requests>16)throw new StoreError('BUDGET_EXCEEDED','Campaign model request budget exceeded.');}run.providerRequests||=[];run.providerRequests.push({...receipt,kind:'npc'});await this.store.saveRun(run);},afterRequest:async receipt=>{run.generations||=[];run.generations.push({...receipt,kind:'npc'});await this.store.saveRun(run);}}):actorDecision(this.store,args.actorId,args.question)},
      {name:'ask_author',description:'Pause for a durable author question; do not invent the answer.',parameters:isModel?Type.Object({text:Type.String({minLength:1,maxLength:1000}),options:Type.Array(Type.String({minLength:1,maxLength:200}),{minItems:2,maxItems:6})},{additionalProperties:false}):Type.Object({}),perform:(args,callId)=>{if(run.pendingQuestion&&!run.pendingQuestion.answer)throw new StoreError('QUESTION_PENDING','Only one question may be pending.');if(isModel&&new Set(args.options).size!==args.options.length)throw new StoreError('ANSWER_INVALID','Question options must be distinct.');run.pendingQuestion=isModel?{id:callId,text:args.text,options:args.options,answer:null}:{id:'travel_intent',text:'Which intention should Mira consider next?',options:['Negotiate a grain escort','Seek more information','Hold position'],answer:null};return run.pendingQuestion;}},
      {name:'roll_check',description:'Record a local fixture d20 once. A roll is evidence, not an automatic state change.',parameters:Type.Object({sides:Type.Literal(20)}),perform:()=>({sides:20,value:randomInt(1,21),purpose:'Synthetic court negotiation check',effect:'Unresolved; no automatic canon mutation'})},
      {name:'edit_record',description:'Apply one validated event-backed field edit, preserving conflicts.',parameters:Type.Object({id:Type.String(),expectedHash:Type.String(),field:Type.String(),value:Type.String(),evidenceId:Type.String()}),perform:(args,callId)=>this.store.edit({id:args.id,operationId:`op_${hash(run.id+callId).slice(0,32)}`,expectedHash:args.expectedHash,patch:{[args.field]:args.value},evidenceIds:[args.evidenceId]},gm)},
    ];
    if(request.action==='story')definitions.push({name:'read_turn',description:'Re-read an exact accepted historical turn by its source handle. Summaries are evidence indexes, never canon.',parameters:Type.Object({id:Type.String()},{additionalProperties:false}),perform:args=>readAcceptedTurn(this.store,args.id)});
    if(isModel&&this.agentWorkspace&&(await this.agentWorkspace.list()).agents.some(a=>a.config.enabled&&a.config.delegatable&&a.config.resourceId))definitions.push({name:'delegate_agent',description:'Enabled child IDs: '+(await this.agentWorkspace.list()).agents.filter(a=>a.config.enabled&&a.config.delegatable&&a.config.resourceId).map(a=>a.config.id).join(', ')+'. Delegate to a configured enabled child ID. It receives its immutable authorized source view and returns a proposal. NPC children receive a neutral task, never this GM text or parent conversation. Routine supported gameplay effects can be staged in GM narration and apply automatically when the turn completes. Separate authoring task commits require exact author approval.',parameters:Type.Object({agentId:Type.String(),input:Type.String({minLength:1,maxLength:8000})},{additionalProperties:false}),perform:(args,callId,signal)=>this.agentWorkspace.delegate({...args,parentRunId:run.id,callId},{signal,parentRequestUse:async()=>{if(++run.requests>16)throw new StoreError('BUDGET_EXCEEDED','Parent and child request budget exceeded.');await this.store.saveRun(run);},parentToolUse:async()=>{if(++run.toolCalls>24)throw new StoreError('BUDGET_EXCEEDED','Parent and child tool budget exceeded.');await this.store.saveRun(run);},parentCheck:async()=>{const owner=await this.store.loadRun('campaign_runtime_owner');if(run.stopRequested||owner?.stopRequested||owner?.token!==run.ownerToken||owner?.status!=='active'||owner.expiresAt<=Date.now())throw new StoreError('CANCELLED','Parent no longer owns the turn.');}})});
    if(isModel&&this.agentWorkspace)definitions.push({name:'read_agent_task',description:'Read a child task spawned by this parent turn. No task from another parent is accessible.',parameters:Type.Object({taskId:Type.String()},{additionalProperties:false}),perform:async args=>{const child=await this.agentWorkspace.task(args.taskId);if(child.parentRunId!==run.id)throw new StoreError('SCOPE_DENIED','Task belongs to another parent.');return this.agentWorkspace.command({intent:'read',payload:args});}});
    if(request.action==='story')definitions.push({name:'stage_entity',description:'Stage a new character, House, location, resource, faction or scoped source event. Stable IDs and forward references validate together at completed narration; this cannot publish a proposal or grant hidden evidence.',parameters:Type.Object({record:Type.Any(),support:Type.String()},{additionalProperties:false}),perform:args=>stageEntity(this.store,run,args)});
    if(request.action==='story')definitions.push({name:'stage_narration',description:'Validate and stage this turn narration with explicit witnessed knowledge and sourced field effects. This tool cannot accept or publish it. End with exactly its body; the turn runtime accepts completed narration and applies validated effects automatically.',parameters:Type.Object({appraisalEffects:Type.Optional(Type.Array(Type.Object({effectId:Type.String(),support:Type.String()},{additionalProperties:false}),{maxItems:8})),body:Type.String({minLength:1,maxLength:12000}),name:Type.String({minLength:1,maxLength:200}),actorIds:Type.Array(Type.String(),{maxItems:20}),knownBy:Type.Array(Type.String(),{maxItems:20}),visibility:Type.Union([Type.Literal('public'),Type.Literal('secret')]),worldTime:Type.String({maxLength:100}),assertions:Type.Array(Type.Object({subjectId:Type.String(),field:Type.String(),value:Type.Any(),kind:Type.Union([Type.Literal('detail'),Type.Literal('event'),Type.Literal('correction')]),support:Type.String()},{additionalProperties:false}),{maxItems:20}),expectedHashes:Type.Record(Type.String(),Type.String())},{additionalProperties:false}),perform:async args=>{run.narrationDraft=await prepareNarration(this.store,run,args);return {status:'staged',fingerprint:run.narrationDraft.fingerprint,body:args.body,effects:args.assertions.length};}});
    if(this.sandbox)definitions.push(
      {name:'grep',description:'Run real grep inside the verified no-network campaign sandbox; return file/line/hash and session receipts.',parameters:Type.Object({query:Type.String()}),perform:(args,callId,signal)=>this.sandbox.grep(args.query,gm,{operationId:'grep_'+hash(run.id+callId).slice(0,40),signal})},
      {name:'run_campaign_command',description:'Execute a bounded command in this campaign sandbox. Supported source-backed file changes publish automatically through the canonical writer; commands cannot bypass schema/canon checks.',parameters:Type.Object({argv:Type.Array(Type.String()),evidenceIds:Type.Array(Type.String())}),perform:(args,callId,signal)=>this.sandbox.command({id:'command_'+hash(run.id+callId).slice(0,40),argv:args.argv,evidenceIds:args.evidenceIds,apply:run.toolPolicy?.edit!==false},gm,{signal})}
    );
if(request.action==='author'){if(!this.authoring)throw new StoreError('AUTHORING_DISABLED','Authoring is not bound in this runtime.');definitions=authorTools(this,run,{question:definitions.find(d=>d.name==='ask_author'),delegation:definitions.find(d=>d.name==='delegate_agent'),taskRead:definitions.find(d=>d.name==='read_agent_task')});}
if(request.action==='story'&&context.campaign?.toolPolicy){const capability={read_agent_task:'decision',delegate_agent:'decision',read_turn:'search',recall:'search',grep:'search',npc_decision:'decision',ask_author:'question',roll_check:'roll',edit_record:'edit',run_campaign_command:'command',stage_entity:'create'};definitions=definitions.filter(definition=>!capability[definition.name]||context.campaign.toolPolicy[capability[definition.name]]);}
    const perform=async(name,args,callId,signal)=>{
      const fingerprint=hash({name,args}),previous=run.toolResults[callId];
      if(previous){if(previous.fingerprint!==fingerprint)throw new StoreError('OPERATION_CONFLICT','Tool call changed during recovery.');return previous.result;}
      if(signal?.aborted||run.stopRequested)throw new StoreError('CANCELLED','Turn stopped before tool execution.');
      if(++run.toolCalls>(isModel?24:12))throw new StoreError('BUDGET_EXCEEDED','Campaign tool budget exceeded.');
      const tool=definitions.find(d=>d.name===name);if(!tool)throw new StoreError('TOOL_DENIED','No tool exists with this name in the campaign scope.');
      args=validateToolArguments(tool,{type:'toolCall',id:callId,name,arguments:args});
      run.activity.push({kind:'tool',name,callId,state:'started'});await this.store.saveRun(run);
      const value=await tool.perform(args,callId,signal),output=result(value);
      if(name==='roll_check'){run.roll=value;run.toolResults[callId]={fingerprint,result:output};await this.store.saveRun(run);}
      try{await this.fault?.('after-tool',name,value);}catch(error){run.stopRequested=true;task.controller?.abort();task.agent?.abort();throw error;}
      run.toolResults[callId]={fingerprint,result:output};run.activity.push({kind:'tool',name,callId,state:'completed',summary:name==='edit_record'?value.status:name==='npc_decision'?value.selected:'Source read'});
      if(name==='npc_decision')run.decision=value;
      if(name==='edit_record'){const {before,after,...receipt}=value;run.receipt=receipt;}
      await this.store.saveRun(run);return output;
    };
    try{
      // A persisted assistant call may precede a crash. Finish its missing result using the same idempotent receipt.
      const last=run.messages.at(-1);
      if(last?.role==='assistant'&&['aborted','error'].includes(last.stopReason))run.messages.pop();
      if(last?.role==='assistant'&&last.stopReason==='stop'){if(request.action==='story')await acceptCompletedNarration(this.store,run,{fault:this.fault});else{run.text=last.content.filter(c=>c.type==='text').map(c=>c.text).join('');run.status='completed';await this.store.saveRun(run);}return run;}
      for(let index=0;index<run.messages.length;index++){
        const message=run.messages[index];if(message.role!=='assistant')continue;
        for(const call of message.content.filter(c=>c.type==='toolCall')){
          const existingIndex=run.messages.findIndex(m=>m.role==='toolResult'&&m.toolCallId===call.id);if(existingIndex>=0){const existing=run.messages[existingIndex];if(!existing.isError||!run.recoverCancelledTools&&!run.toolResults[call.id])continue;run.messages.splice(existingIndex,1);}
          const output=await perform(call.name,call.arguments,call.id);
          let resultIndex=index+1;while(run.messages[resultIndex]?.role==='toolResult')resultIndex++;
          run.messages.splice(resultIndex,0,{role:'toolResult',toolCallId:call.id,toolName:call.name,content:output.content,isError:false,timestamp:Date.now()});await this.store.saveRun(run);
        }
      }
      delete run.recoverCancelledTools;await this.store.saveRun(run);
      const fixtureStream=async(_model,context,options)=>{
        const stream=createAssistantMessageEventStream();
        const completed=new Set(context.messages.filter(m=>m.role==='toolResult'&&!m.isError).map(m=>m.toolCallId));
        const read=run.toolResults.read?.result.details;
        const plan=[{id:'read',name:'read_record',arguments:{id:'mira'}},{id:'recall',name:this.sandbox?'grep':'recall',arguments:{query:request.action==='treat'?'healer':'grain'}},{id:'decision',name:'npc_decision',arguments:{actorId:'mira',question:request.action==='treat'?'healer':'unknown proposal'}}];
        if(['treat','conflict'].includes(request.action))plan.push({id:'edit',name:'edit_record',arguments:{id:'mira',expectedHash:read?.hash||'',field:request.action==='treat'?'data.current.condition':'data.identity.originId',value:request.action==='treat'?'Recovering after treatment':'westmere',evidenceId:request.action==='treat'?'evt_treatment':'evt_retcon'}});
        if(request.action==='question')plan.push({id:'question',name:'ask_author',arguments:{}});
        if(request.action==='roll')plan.push({id:'roll',name:'roll_check',arguments:{sides:20}});
        const next=plan.find(p=>!completed.has(p.id));
        await new Promise(resolve=>setTimeout(resolve,this.delayMs));
        const aborted=options?.signal?.aborted||run.stopRequested;
        const error=run.requests>8?'Fixture request budget exceeded':null;
        const text=run.pendingQuestion?.answer?`The author selected Mira’s intention: ${run.pendingQuestion.answer}. No outcome or state change has been assumed.`:run.roll?`Court negotiation check: d20 = ${run.roll.value}. The outcome remains unresolved; accepted files are unchanged.`:run.receipt?.status==='applied'?'The healer binds Mira’s hand. Her accepted Current section now records: Recovering after treatment. Mira intends to cooperate; further consequences remain unresolved.':run.receipt?.status==='unchanged'?'Mira’s treatment is already recorded. Later accepted state and explicit author changes remain in place. No duplicate state change was published.':run.receipt?.status==='conflict'?'The traveler’s account conflicts with Mira’s established origin. Canon is preserved and the proposed correction is recorded for review.':'Mira holds her position. No event supports a new state change.';
        const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,usage:zeroUsage,timestamp:Date.now(),stopReason:aborted?'aborted':error?'error':next?'toolUse':'stop',content:aborted||error?[]:next?[{type:'toolCall',...next}]:[{type:'text',text}],...(error?{errorMessage:error}:{})};
        stream.push(aborted||error?{type:'error',reason:message.stopReason,error:message}:{type:'done',reason:message.stopReason,message});stream.end();return stream;
      };

      const selectedModel=isModel?this.transport.model:model,streamFn=isModel?this.transport.stream(run,this.store,definitions):fixtureStream;
      if(isModel){
        if(!run.promptSnapshot){const compiled=await assembleGmPrompt(this.store,run.resourceSnapshot,request,{role:request.action==='author'?'assistant':'gm'});run.promptSnapshot={...compiled,tools:definitions.map(({name,description,parameters})=>({name,description,parameters}))};run.promptSnapshot.toolsHash=hash(run.promptSnapshot.tools);}
        validatePromptSnapshot(run.promptSnapshot);if(run.promptSnapshot.resourceRevision!==run.resourceSnapshot.revision)throw new StoreError('PROMPT_SNAPSHOT_INVALID','Prompt and resource revisions differ.');if(run.promptSnapshot.toolsHash!==hash(definitions.map(({name,description,parameters})=>({name,description,parameters}))))throw new StoreError('PROMPT_CAPABILITIES_CHANGED','Tools changed since this turn was pinned; stop it and submit a new turn.');
      }
      const systemPrompt=isModel?run.promptSnapshot.systemPrompt:'Offline qualification scenario; no model dispatch.';
      if(isModel&&run.promptSnapshot.providerMode&&!run.messages.length&&!run.promptSeed){const packet=run.promptSnapshot.campaignContextPacket,previous=(await this.store.runs()).filter(r=>r.id!==run.id&&r.request?.action===request.action&&r.status==='completed').sort((a,b)=>a.at.localeCompare(b.at)).at(-1),prepared=await prepareDurableConversation({store:this.store,transport:this.transport,run,signal:task.controller.signal,role:request.action==='author'?'assistant':'gm',action:request.action,previous,context:{campaignContext:packet.campaignContext,actionType:packet.actionType},priorTurns:packet.priorTurns,system:systemPrompt,tools:run.promptSnapshot.tools,recentTurns:packet.campaignContext.campaign?.preferences.recentTurns||8,maxBytes:Math.min(90000,(packet.campaignContext.campaign?.preferences.contextTokens||32768)*2)});run.promptSeed=prepared.messages;run.promptEnvelope=prepared.envelope;}
      if(isModel&&!run.initialPromptMessages)run.initialPromptMessages=[...(run.promptSeed||[]),{role:'user',content:request.text,timestamp:0}];
      if(isModel)await this.store.saveRun(run);
      const agent=createSharedAgent({transformContext:async messages=>{const projection=projectToolBodies(messages,isModel?Math.min(140000,(context.campaign?.preferences.contextTokens||32768)*4):140000);if(projection.omitted.length){run.contextProjections||=[];const receipt={hash:hash(projection.omitted),omitted:projection.omitted,bytes:projection.bytes};if(!run.contextProjections.some(r=>r.hash===receipt.hash)){run.contextProjections.push(receipt);await this.store.saveRun(run);}}if(!projection.fits)throw new StoreError('CONTEXT_BUDGET','Current conversation exceeds its allowance after safe tool projection; raw dialogue is retained.');return projection.messages;},initialState:{systemPrompt,model:selectedModel,tools:definitions.map(d=>({...d,execute:(callId,args,signal)=>perform(d.name,args,callId,signal)})),messages:(run.messages.length?run.messages:run.promptSeed||[]).filter(m=>m.role!=='system')},toolExecution:'sequential',streamFn,prepareRequest:async()=>{if(++run.requests>(isModel?16:8))throw new StoreError('BUDGET_EXCEEDED','Campaign request budget exceeded.');await this.store.saveRun(run);},beforeToolCall:async()=>run.stopRequested?{block:true,reason:'Stopped',terminate:true}:undefined,finishTurn:()=>run.pendingQuestion&&!run.pendingQuestion.answer?{action:'end'}:undefined});
      task.agent=agent;
      let checkpoints=Promise.resolve();
      agent.subscribe(event=>{
        if(event.type==='message_start')delete run.streamingText;
        if(event.type==='message_update'&&event.assistantMessageEvent?.type==='text_delta'){run.streamingText=event.message.content.filter(c=>c.type==='text').map(c=>c.text).join('');if(Date.now()-(run.streamSavedAt||0)>=80){run.streamSavedAt=Date.now();const saved=this.store.saveRun(structuredClone(run));checkpoints=Promise.all([checkpoints,saved]).then(()=>{});checkpoints.catch(()=>{});}}
        if(event.type==='message_end'){delete run.streamingText;delete run.streamSavedAt;run.messages=structuredClone(agent.state.messages);delete run.promptSeed;if(event.message?.role==='assistant'&&!['error','aborted'].includes(event.message.stopReason))delete run.pendingProviderId;}
        if(event.type==='turn_end')run.activity.push({kind:'turn',state:'checkpoint'});
        if(['message_end','turn_end'].includes(event.type)){const saved=this.store.saveRun(structuredClone(run));checkpoints=Promise.all([checkpoints,saved]).then(()=>{});checkpoints.catch(()=>{});}
      });
      if(run.messages.length)await agent.continue();else await agent.prompt(request.text||request.action);
      await checkpoints;
      run.messages=structuredClone(agent.state.messages);
      const final=run.messages.findLast(m=>m.role==='assistant');
      run.text=final?.content.filter(c=>c.type==='text').map(c=>c.text).join('')||'';
      run.status=(run.pendingQuestion&&!run.pendingQuestion.answer)||run.stopRequested||final?.stopReason==='aborted'?'paused':final?.stopReason==='error'||(!isModel&&Object.values(run.toolResults).length<(request.action==='hold'?3:4))?'failed':'completed';
      if(request.action==='story'&&run.status==='completed')await acceptCompletedNarration(this.store,run,{fault:this.fault});
      if(request.action==='author')run.worldWrites=0;
      run.error=final?.errorMessage||null;
    }catch(error){run.status='paused';run.error=error.message;}
    delete run.streamingText;delete run.streamSavedAt;run.finishedAt=new Date().toISOString();await this.store.saveRun(run);return run;
  }
}

// General campaign turns share the same durable owner as the legacy qualification scenarios.
export class CampaignEngine extends FixtureEngine {}
