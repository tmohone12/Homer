import {normalizeProviderUsage} from './promptCaching.mjs';
import {createAssistantMessageEventStream,validateToolArguments,getCurrentSystemPrompt} from '@earendil-works/pi-ai';
import {z} from 'zod';
import {hash,StoreError} from './store.mjs';
export const campaignModel={id:'campaign-agent',name:'Campaign agent',api:'openai-completions',provider:'injected',baseUrl:'disabled:',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:4096};
const emptyUsage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
export function nativeHistory(messages){return messages.flatMap(message=>{
 if(message.role==='user')return [{role:'user',content:typeof message.content==='string'?message.content:message.content.filter(c=>c.type==='text').map(c=>c.text).join('')}];
 if(message.role==='toolResult')return [{role:'tool',toolCallId:message.toolCallId,toolName:message.toolName,content:message.content.filter(c=>c.type==='text').map(c=>c.text).join(''),isError:message.isError===true}];
 if(message.role==='assistant')return [message.nativeMessage||{role:'assistant',content:message.content.filter(c=>c.type==='text').map(c=>c.text).join(''),toolCalls:message.content.filter(c=>c.type==='toolCall').map(({id,name,arguments:args})=>({id,name,arguments:args}))}];
 return [];
});}
const call=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),name:z.string().min(1).max(80),arguments:z.record(z.string(),z.unknown())}).strict();
const native=z.object({role:z.literal('assistant'),content:z.string().max(16000),toolCalls:z.array(call).max(8).optional(),providerContinuation:z.record(z.string(),z.unknown()).optional()}).strict();
function cancellation(signal){if(signal?.aborted)throw new StoreError('CANCELLED','Campaign generation stopped.');}
async function bounded(work,signal,timeoutMs){
 cancellation(signal);let timer,abort;
 const halt=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new StoreError('PROVIDER_TIMEOUT','Campaign generation timed out.')),timeoutMs);abort=()=>reject(new StoreError('CANCELLED','Campaign generation stopped.'));signal?.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([work,halt]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
/** Uses the existing ServerGenerationOptions/Result protocol. No implicit provider or credential lookup.
 * @param {{generate:(request:any)=>Promise<any>,profile?:any,model?:string,name?:string,paid?:boolean,maxTokens?:number,timeoutMs?:number,accounting?:any,configureRequest?:any}} options
 */
export function createCampaignTransport({generate,profile,model='campaign-agent',name='Injected synthetic provider',paid=false,maxTokens=4096,timeoutMs=15000,accounting,configureRequest}){
 if(typeof generate!=='function')throw new StoreError('PROVIDER_DISABLED','Campaign transport must be explicitly injected.');
 if(paid!==false)throw new StoreError('PROVIDER_DISABLED','Paid transport is disabled in this work-copy qualification.');
 if(profile?.apiKey)throw new StoreError('CREDENTIAL_DENIED','Qualification transport accepts no provider credentials.');
 const settings={profile:profile||{providerType:'fixture',apiKey:'',baseUrl:'disabled:'},model,maxTokens,timeoutMs,maxRetries:0,parallelToolCalls:false,appendPrompt:false,providerOutputLimit:false,agentBudgetManaged:true,streamNativeTools:true};
 const adapter={name,paid:false,model:{...campaignModel,id:model,name},async generate(options,{signal,beforeRequest,afterRequest,operationId,scopeId,purpose='gm',onTextDelta}={}){
  cancellation(signal);let configured={};if(configureRequest){const configuring=new AbortController(),cancelConfig=()=>configuring.abort(signal?.reason);signal?.addEventListener('abort',cancelConfig,{once:true});if(signal?.aborted)configuring.abort();try{configured=await bounded(Promise.resolve().then(()=>configureRequest(options,{purpose,signal:configuring.signal})),signal,timeoutMs)||{};cancellation(signal);}finally{configuring.abort();signal?.removeEventListener('abort',cancelConfig);}}const request={...settings,...options,...configured,signal},inputFingerprint=hash({system:request.system,messages:request.messages,prompt:request.prompt,tools:request.tools,providerRequest:request.providerRequest?.body,profileId:request.profile?.id,model:request.model});let ledger;
  if(accounting&&(!operationId||!scopeId))throw new StoreError('PROVIDER_PROTOCOL','Accounted generation requires stable operation and scope identities.');
  delete request.onTextDelta;let streamedText='',deltaCount=0,acceptDeltas=true;
  if(typeof onTextDelta==='function')request.onTextDelta=async chunk=>{cancellation(signal);if(!acceptDeltas||controller.signal.aborted)throw new StoreError('CANCELLED','Late provider stream discarded.');if(!dispatched)throw new StoreError('PROVIDER_PROTOCOL','Text arrived before the pre-dispatch checkpoint.');if(typeof chunk!=='string'||++deltaCount>2048||streamedText.length+chunk.length>16000)throw new StoreError('PROVIDER_PROTOCOL','Streamed provider text exceeds its bound.');streamedText+=chunk;await onTextDelta(chunk);cancellation(signal);};
  if(Buffer.byteLength(JSON.stringify({system:request.system,messages:request.messages,prompt:request.prompt,tools:request.tools}))>180000)throw new StoreError('CONTEXT_BUDGET','Campaign context exceeds its bounded request budget.');
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  let dispatched=false,requestOpen=true;const assertOpen=()=>{cancellation(signal);cancellation(controller.signal);if(!requestOpen)throw new StoreError('CANCELLED','Provider dispatch window is closed.');};
  request.signal=controller.signal;
  request.onBeforeRequest=async receipt=>{assertOpen();if(dispatched)throw new StoreError('REQUEST_RETRY_DENIED','A campaign request cannot dispatch twice.');if(!Number.isFinite(receipt.inputTokens)||!Number.isFinite(receipt.reservedOutputTokens)||receipt.inputTokens<0||receipt.reservedOutputTokens<=0||receipt.inputTokens+receipt.reservedOutputTokens>request.profile.contextWindowTokens||request.tokenBudget!==undefined&&receipt.inputTokens+receipt.reservedOutputTokens>request.tokenBudget)throw new StoreError('CONTEXT_BUDGET','Provider token reservation exceeds campaign context.');dispatched=true;if(accounting)ledger=await accounting.reserve({operationId,scopeId,kind:purpose,profileId:request.selectedProfileId,inputFingerprint,requestHash:hash(receipt.serializedBody),inputTokens:receipt.inputTokens,outputTokens:receipt.reservedOutputTokens});try{assertOpen();await beforeRequest?.({requestHash:hash(receipt.serializedBody||{system:request.system,messages:request.messages}),inputTokens:receipt.inputTokens,reservedOutputTokens:receipt.reservedOutputTokens});assertOpen();}catch(error){if(ledger&&accounting)await accounting.unknown(ledger,error);throw error;}};
  // The checkpoint precedes invocation even when a synthetic adapter has no HTTP dispatch.
  try{
   await beforeRequest?.({requestHash:hash({system:request.system,messages:request.messages,prompt:request.prompt,tools:request.tools}),stage:'prepared'});assertOpen();
   const previous=accounting?await accounting.cached({operationId,scopeId,inputFingerprint}):null;
   if(previous){dispatched=true;ledger=previous;}
   let result=previous?.response||await bounded(Promise.resolve().then(()=>generate(request)),signal,request.timeoutMs);cancellation(signal);result={...result,usage:{...result.usage,...normalizeProviderUsage(result.usage)}};
   if(!dispatched)throw new StoreError('PROVIDER_PROTOCOL','Transport omitted the required pre-dispatch checkpoint.');
   if(Buffer.byteLength(JSON.stringify(result))>262144)throw new StoreError('PROVIDER_PROTOCOL','Provider output exceeds 256 KiB.');
   const message=native.parse(result.message||{role:'assistant',content:result.text||'',...(result.toolCalls?.length?{toolCalls:result.toolCalls}:{})});
   if(deltaCount&&streamedText.trim()!==message.content.trim())throw new StoreError('PROVIDER_PROTOCOL','Completed provider text differs from the streamed draft.');
   if(result.finishReason&&!['stop','end_turn','tool_calls','tool_use','function_call'].includes(result.finishReason))throw new StoreError('PROVIDER_INCOMPLETE','Incomplete provider response cannot establish campaign narration.');
   if(!message.toolCalls?.length&&!message.content.trim())throw new StoreError('PROVIDER_EMPTY','Provider returned neither narration nor tools.');
   if(Buffer.byteLength(JSON.stringify(message.providerContinuation||{}))>65536)throw new StoreError('PROVIDER_PROTOCOL','Provider continuation exceeds bounded history.');
   if(accounting&&!previous)await accounting.complete(ledger,{...result,message});
   await afterRequest?.({model:result.model||model,finishReason:result.finishReason||'stop',usage:result.usage||{},requestHash:hash({system:request.system,messages:request.messages}),responseHash:hash(message)});
   return {...result,message};
  }catch(error){if(ledger)await accounting.unknown(ledger,error);throw error;}finally{requestOpen=false;acceptDeltas=false;controller.abort();signal?.removeEventListener('abort',abort);}
 },stream(run,store,definitions){return (_model,context,options)=>{
  const stream=createAssistantMessageEventStream();
  void(async()=>{try{
   run.pendingProviderId||='request_'+hash([run.id,run.requests,run.agentPurpose||'gm']).slice(0,40);await store.saveRun(run);
   const partial={role:'assistant',content:[],api:adapter.model.api,provider:adapter.model.provider,model:adapter.model.id,usage:emptyUsage,stopReason:'stop',timestamp:Date.now()};let started=false;
   const result=await adapter.generate({system:getCurrentSystemPrompt(context.messages),messages:nativeHistory(context.messages),prompt:'',campaignContextPacket:run.promptSnapshot?.campaignContextPacket,selectedProfileId:run.selectedProfileId,cacheActorId:run.cacheActorId,agentRole:run.agentPurpose,tokenBudget:run.tokenBudget,expectedProviderFingerprint:run.promptSnapshot?.providerFingerprint,cachePrefixLength:run.promptEnvelope?.cachePrefixLength||0,tools:definitions.map(({name,description,parameters})=>({name,description,parameters}))},{signal:options?.signal,operationId:run.pendingProviderId,scopeId:run.accountingScopeId||run.id,purpose:run.agentPurpose||'gm',onTextDelta:async chunk=>{if(!started){started=true;partial.content.push({type:'text',text:''});stream.push({type:'start',partial});stream.push({type:'text_start',contentIndex:0,partial});}partial.content[0].text+=chunk;stream.push({type:'text_delta',contentIndex:0,delta:chunk,partial});},beforeRequest:async receipt=>{run.providerRequests||=[];run.providerRequests.push(receipt);await store.saveRun(run);},afterRequest:async receipt=>{run.tokensUsed=(run.tokensUsed||0)+(receipt.usage?.totalTokens||0);if(run.tokensUsed>131072)throw new StoreError('BUDGET_EXCEEDED','Campaign total token budget exceeded.');run.generations||=[];run.generations.push(receipt);await store.saveRun(run);}});
   const message=result.message,seen=new Set();
   for(const toolCall of message.toolCalls||[]){if(seen.has(toolCall.id))throw new StoreError('TOOL_ID_CONFLICT','Duplicate native tool ID.');seen.add(toolCall.id);const definition=definitions.find(d=>d.name===toolCall.name);if(!definition)throw new StoreError('TOOL_DENIED','Provider requested an unavailable campaign tool.');validateToolArguments(definition,{type:'toolCall',...toolCall});const prior=run.toolResults[toolCall.id];if(prior&&prior.fingerprint!==hash({name:toolCall.name,args:toolCall.arguments}))throw new StoreError('OPERATION_CONFLICT','Provider reused a tool ID with different arguments.');}
   const usage=result.usage||{},assistant={role:'assistant',content:[...(message.content?[{type:'text',text:message.content}]:[]),...(message.toolCalls||[]).map(c=>({type:'toolCall',...c}))],api:adapter.model.api,provider:adapter.model.provider,model:result.model||adapter.model.id,usage:{...emptyUsage,input:usage.inputTokens||0,output:usage.outputTokens||0,totalTokens:usage.totalTokens||0},stopReason:message.toolCalls?.length?'toolUse':'stop',timestamp:Date.now(),nativeMessage:message};
   if(started)stream.push({type:'text_end',contentIndex:0,content:message.content,partial:assistant});
   stream.push({type:'done',reason:assistant.stopReason,message:assistant});
  }catch(error){const assistant={role:'assistant',content:[],api:adapter.model.api,provider:adapter.model.provider,model:adapter.model.id,usage:emptyUsage,stopReason:options?.signal?.aborted?'aborted':'error',timestamp:Date.now(),errorMessage:error.message};stream.push({type:'error',reason:assistant.stopReason,error:assistant});}finally{stream.end();}})();return stream;
 };}};
 return adapter;
}