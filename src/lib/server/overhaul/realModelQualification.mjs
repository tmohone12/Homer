import {StoreError} from './store.mjs';
export const REAL_MODEL_QUALIFICATION=Object.freeze({providerType:'openrouter',baseUrl:'https://openrouter.ai/api/v1',model:'z-ai/glm-5',endpoint:'streamlake/fp8',inputUsdPerMillion:0.6,outputUsdPerMillion:1.92,maxRequests:2,maxRetries:0,maxInputTokens:4096,maxOutputTokens:512,maxSerializedBytes:4096,maxCostUsd:0.01,timeoutMs:30000});
function deny(code,message){throw new StoreError(code,message);}
/** Private one-shot qualification capability, never exposed by preview/browser/MCP.
 * Default denies execution. Real provider owner, credential broker and fresh verified public
 * catalog must be injected after approval. Tests use mocks; no credentials are read here. */
export function createRealModelQualificationGate({generate,allowExecution=false,verifiedPricing}={}){
 let requests=0,reservedUsd=0,halted=false;const plan=REAL_MODEL_QUALIFICATION;
 const dispatch=async options=>{
  if(!allowExecution)deny('QUALIFICATION_DISABLED','Real model qualification has not been authorized.');if(typeof generate!=='function'||typeof verifiedPricing!=='function')deny('QUALIFICATION_CONFIG','Private provider and verified catalog capabilities are required.');if(halted||requests>=plan.maxRequests)deny('QUALIFICATION_BUDGET','Qualification is exhausted or halted after a failed outcome.');
  if(options.model!==plan.model||options.profile?.providerType!==plan.providerType||options.profile?.baseUrl!==plan.baseUrl||options.tools?.length||options.messages?.length>4||options.systemDynamic||options.contextAfterDialogue||options.cache)deny('QUALIFICATION_CONFIG','Only the reviewed small synthetic GM/NPC requests are admitted.');
  const pricing=await verifiedPricing();if(pricing.model!==plan.model||pricing.endpoint!==plan.endpoint||pricing.inputUsdPerMillion!==plan.inputUsdPerMillion||pricing.outputUsdPerMillion!==plan.outputUsdPerMillion||!pricing.source||!Number.isFinite(Date.parse(pricing.at))||Date.now()-Date.parse(pricing.at)>3600000||Date.parse(pricing.at)>Date.now())deny('PRICE_UNVERIFIED','Catalog/endpoint/prices differ or are stale.');
  const provider={only:[plan.endpoint],order:[plan.endpoint],allow_fallbacks:false,require_parameters:true,max_price:{prompt:plan.inputUsdPerMillion,completion:plan.outputUsdPerMillion,request:0}};let dispatched=false;
  const request={...options,model:plan.model,maxTokens:plan.maxOutputTokens,maxRetries:0,timeoutMs:plan.timeoutMs,providerOutputLimit:false,parallelToolCalls:false,appendPrompt:false,reasoningEffort:'off',openRouterProvider:provider,onBeforeRequest:async receipt=>{
   if(dispatched||halted||requests>=plan.maxRequests)deny('QUALIFICATION_BUDGET','Another HTTP dispatch or retry is denied.');let body;try{body=JSON.parse(receipt.serializedBody);}catch{deny('QUALIFICATION_PROTOCOL','Missing serialized pre-dispatch body.');}
   if(Buffer.byteLength(receipt.serializedBody)>plan.maxSerializedBytes||body.model!==plan.model||body.max_tokens!==plan.maxOutputTokens||JSON.stringify(body.provider)!==JSON.stringify(provider)||body.tools?.length||!Number.isInteger(receipt.inputTokens)||receipt.inputTokens<0||receipt.inputTokens>plan.maxInputTokens||receipt.reservedOutputTokens!==plan.maxOutputTokens)deny('QUALIFICATION_BUDGET','Actual request exceeds its reviewed payload, route or token limits.');
   const reservation=(plan.maxInputTokens*plan.inputUsdPerMillion+plan.maxOutputTokens*plan.outputUsdPerMillion)/1000000;if(reservedUsd+reservation>plan.maxCostUsd)deny('QUALIFICATION_BUDGET','Total dollar cap would be exceeded.');requests++;reservedUsd+=reservation;dispatched=true;await options.onBeforeRequest?.({...receipt,inputTokens:plan.maxInputTokens});
  }};
  try{const response=await generate(request);if(!dispatched)deny('QUALIFICATION_PROTOCOL','Provider omitted its awaited pre-dispatch hook.');return response;}catch(error){halted=true;throw error;}
 };dispatch.summary=()=>({requests,reservedUsd,halted,maxRequests:2,maxCostUsd:0.01});return dispatch;
}