import {gmResourceCommand} from './gmPrompt.mjs';
import {buildWorldDraft} from '../../contracts/worldDraft.mjs';
import {askAssistant} from './assistant.mjs';
import {controlCommand} from './controls.mjs';
import {z} from 'zod';import {campaignTurnCommand} from './turn.mjs';import {campaignContext} from './context.mjs';import {groundedDecision} from './decisions.mjs';import {hash} from './store.mjs';
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),authority=actorId=>actorId?{role:'npc',actorId}:{role:'assistant'};
export const campaignTools=[
 {name:'assistant_resources',description:'Read, preview, edit, inspect or restore shared Assistant Markdown/config resources. Existing requests keep their pinned revision.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['read','preview','save','rollback','inspect']},payload:{type:'object'},instructions:{type:'string'},configYaml:{type:'string'},runId:{type:'string'}},required:['intent'],additionalProperties:false}},
 {name:'author_workspace',description:'Navigate bounded world files and review durable Assistant proposals. Explicit exact approval precedes publication; undo preserves newer revisions.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['list','read','approve','commit','reject','cancel','undo','preview','navigate','range']},payload:{type:'object'}},required:['intent'],additionalProperties:false}},
 {name:'memory_status',description:'Read app-resolved scoped source coverage, staleness, process binding and canonical fallback status. Cannot enable workers or supply a root.',inputSchema:{type:'object',properties:{actorId:{type:'string'}},additionalProperties:false}},
 {name:'gm_resources',description:'Read, preview, save, inspect pinned turn instructions or roll back explicit shared Homer GM resources. Prompt text grants no capability.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['read','preview','save','rollback','inspect']},payload:{type:'object'},instructions:{type:'string'},configYaml:{type:'string'},runId:{type:'string'}},required:['intent'],additionalProperties:false}},
 {name:'provider_models',description:'Get/refresh fixed-host OpenRouter or NanoGPT model metadata; no credential validation or generation.',inputSchema:{type:'object',properties:{provider:{type:'string',enum:['openrouter','nanogpt']},refresh:{type:'boolean'}},required:['provider'],additionalProperties:false}},
 {name:'child_resources',description:'Read templates or save bounded child Markdown instructions and permissions for the next task.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['list','save']},payload:{type:'object'}},required:['intent'],additionalProperties:false}},
 {name:'agent_workspace',description:'Configure neutral scoped agents/sessions/tasks. Workers propose only; author approves exact content for a versioned atomic shared-canon commit. No fixed roles or schedules.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['list','configure','session','submit','execute','propose','approve','commit','cancel','read','recover']},payload:{type:'object'}},required:['intent'],additionalProperties:false}},
 {name:'campaign_create',description:'Create a typed blank linked world record with versioned Markdown and an undo receipt.',inputSchema:{type:'object',properties:{operationId:{type:'string'},draft:{type:'object'}},required:['operationId','draft'],additionalProperties:false}},
 {name:'campaign_workspace',description:'List, create or select an isolated campaign; retain per-campaign session state. No external root or provider permission.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['list','create','select','view']},operationId:{type:'string'},name:{type:'string'},mode:{type:'string',enum:['blank','example']},campaignId:{type:'string'},view:{type:'object'}},required:['intent'],additionalProperties:false}},
 {name:'campaign_assistant',description:'Submit an authoring request through the shared Assistant agent. It explores scoped files and prepares proposals; exact author review is required before publication.',inputSchema:{type:'object',properties:{operationId:{type:'string'},question:{type:'string'}},required:['operationId','question'],additionalProperties:false}},
 {name:'campaign_controls',description:'Read or save author campaign/player/faction controls; create source-versioned summaries or local media. Provider selection grants no dispatch permission.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['read','save','summary','media','rollback','transcript','reconcileSynthetic']},payload:{type:'object'}},required:['intent'],additionalProperties:false}},
 {name:'campaign_read',description:'Read a canonical record or the supplied NPC view.',inputSchema:{type:'object',properties:{id:{type:'string'},actorId:{type:'string'}},required:['id'],additionalProperties:false}},
 {name:'campaign_search',description:'Real campaign grep for the author; actor-filtered literal fallback for an NPC.',inputSchema:{type:'object',properties:{query:{type:'string'},actorId:{type:'string'}},required:['query'],additionalProperties:false}},
 {name:'campaign_context',description:'Read persistent GM context choices.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'campaign_turn',description:'Submit, read, resume, stop or answer a campaign story turn through the familiar shared owner.',inputSchema:{type:'object',properties:{intent:{type:'string',enum:['submit','run','resume','stop','answer','dismiss']},turn:{type:'object'},id:{type:'string'},choice:{type:'string'}},required:['intent'],additionalProperties:false}},
 {name:'npc_decision',description:'Return a source-grounded actor intention and optional configured appraisal, never a guaranteed outcome.',inputSchema:{type:'object',properties:{actorId:{type:'string'},question:{type:'string'},operationId:{type:'string'},observedAction:{type:'object'}},required:['actorId','question','operationId'],additionalProperties:false}},
 {name:'campaign_edit',description:'Explicit author field edit with optimistic source hash and undo receipt.',inputSchema:{type:'object',properties:{edit:{type:'object'}},required:['edit'],additionalProperties:false}},
 {name:'campaign_undo',description:'Undo a revision-safe campaign receipt.',inputSchema:{type:'object',properties:{receiptId:{type:'string'},undo:{type:'object'}},required:['receiptId','undo'],additionalProperties:false}},
];
export async function campaignToolCall(service,name,args){
 const {store,sandbox,engine}=service;
 if(name==='assistant_resources')return gmResourceCommand(service,args,{role:'assistant'});
 if(name==='author_workspace')return service.authoring.command(args);
 if(name==='memory_status'){const request=z.object({actorId:id.optional()}).strict().parse(args);return engine.memory.status(authority(request.actorId));}
 if(name==='gm_resources')return gmResourceCommand(service,args);
 if(name==='provider_models')return service.providerCatalog.get(args);
 if(name==='child_resources')return service.childResources.command(args);
 if(name==='agent_workspace')return service.agentWorkspace.command(args);
 if(name==='campaign_workspace'){if(!service.registry)throw Error('Campaign registry is unavailable for this injected service.');return service.registry.command(service.sessionId||'cli',args,service.campaignId);}
 if(name==='campaign_create'){const request=z.object({operationId:id,draft:z.unknown()}).strict().parse(args);const {before,after,...receipt}=await store.create({operationId:request.operationId,record:buildWorldDraft(request.draft)},{role:'assistant'});return receipt;}
 if(name==='campaign_controls')return controlCommand(service,args);
 if(name==='campaign_assistant')return askAssistant(service,args);
 if(name==='campaign_turn')return campaignTurnCommand(service,args);
 if(name==='campaign_read'){const request=z.object({id,actorId:id.optional()}).strict().parse(args);return store.read(request.id,authority(request.actorId));}
 if(name==='campaign_search'){const request=z.object({query:z.string().trim().min(1).max(300),actorId:id.optional()}).strict().parse(args);return sandbox.grep(request.query,authority(request.actorId),{operationId:'client_'+hash([Date.now(),request]).slice(0,40)});}
 if(name==='campaign_context'){z.object({}).strict().parse(args);return campaignContext(store,{role:'assistant'});}
 if(name==='npc_decision'){const request=z.object({actorId:id,question:z.string().min(1).max(2000),operationId:id,observedAction:z.object({actorId:id,text:z.string().min(1).max(2000),actionType:z.enum(['do','say','story','free'])}).strict().optional()}).strict().parse(args);return groundedDecision(store,request,engine.transport,{memory:engine.memory});}
 if(name==='campaign_edit'){const request=z.object({edit:z.unknown()}).strict().parse(args);const {before,after,...receipt}=await store.edit(request.edit,{role:'assistant'});return receipt;}
 if(name==='campaign_undo'){const request=z.object({receiptId:id,undo:z.unknown()}).strict().parse(args);const {before,after,...receipt}=await store.undo(request.receiptId,request.undo,{role:'assistant'});return receipt;}
 throw Error('Unknown scoped campaign tool.');
}
export async function campaignRpc(service,input){
 const request=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string().max(100),z.number().finite()]).optional(),method:z.string().max(100),params:z.record(z.string(),z.unknown()).optional()}).strict().parse(input);
 if(request.method==='notifications/initialized'&&request.id===undefined)return null;
 let result;
 if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'homer-isolated-campaign',version:'1.0.0'}};
 else if(request.method==='ping')result={};
 else if(request.method==='tools/list')result={tools:campaignTools};
 else if(request.method==='tools/call'){const params=z.object({name:z.string(),arguments:z.record(z.string(),z.unknown()).default({})}).strict().parse(request.params);try{const value=await campaignToolCall(service,params.name,params.arguments);result={content:[{type:'text',text:JSON.stringify(value)}],isError:false};}catch(error){result={content:[{type:'text',text:JSON.stringify({error:error.message,code:error.code||'INVALID_REQUEST'})}],isError:true};}}
 else return {jsonrpc:'2.0',id:request.id??null,error:{code:-32601,message:'Method not supported by the scoped campaign server.'}};
 return request.id===undefined?null:{jsonrpc:'2.0',id:request.id,result};
}
