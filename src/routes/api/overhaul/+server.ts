import {gmResourceCommand} from '$lib/server/overhaul/gmPrompt.mjs';
import {askAssistant} from '$lib/server/overhaul/assistant.mjs';
import {controlCommand} from '$lib/server/overhaul/controls.mjs';
import {groundedDecision} from '$lib/server/overhaul/decisions.mjs';
import {hash} from '$lib/server/overhaul/store.mjs';
import {campaignContext} from '$lib/server/overhaul/context.mjs';
import {json} from '@sveltejs/kit';
import {campaignService,campaignRegistry,campaignRequestScope,fixtureState,migrationFixtureStore} from '$lib/server/overhaul/service.mjs';
import {publicRun,actorDecision} from '$lib/server/overhaul/engine.mjs';
import {ingestAcceptedEvent,saveLocation,locationContext,migrationDryRun} from '$lib/server/overhaul/workflows.mjs';
export async function GET({request}:any){try{return json(await fixtureState(campaignRequestScope(request)));}catch(error:any){return json({error:error.message,code:error.code||'FIXTURE_UNAVAILABLE'},{status:503});}}
export async function POST({request}:any){
 try{
  const reader=request.body.getReader(),chunks=[];let bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){await reader.cancel();throw Error('Request exceeds 64 KiB.');}chunks.push(value);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8')),scope=campaignRequestScope(request);if(body.intent==='workspace')return json(await(await campaignRegistry()).command(scope.sessionId,body.command,scope.campaignId));const service=await campaignService(scope),{store,engine,sandbox,agentWorkspace,providerCatalog}=service;let result;
  if(body.intent==='operator'){if(!service.operator)throw Object.assign(Error('Provider account setup is available only in the separate local Homer installation.'),{code:'OPERATOR_UNAVAILABLE'});result=await service.operator.command(body.command);}
  else if(body.intent==='resources')result=await gmResourceCommand(service,body.command);
  else if(body.intent==='assistantResources')result=await gmResourceCommand(service,body.command,{role:'assistant'});
  else if(body.intent==='authoring')result=await service.authoring.command(body.command);
  else if(body.intent==='memoryStatus')result=await engine.memory.status(body.actorId?{role:'npc',actorId:body.actorId}:{role:'assistant'});
  else if(body.intent==='childResources')result=await service.childResources.command(body.command);
  else if(body.intent==='contextReceipts')result=(await store.runs()).filter((r:any)=>r.kind==='context-compaction');
  else if(body.intent==='models')result=await providerCatalog.get(body.catalog);
  else if(body.intent==='agents')result=await agentWorkspace.command(body.command);
  else if(body.intent==='assistant')result=await askAssistant(service,body.query);
  else if(body.intent==='controls')result=await controlCommand({store,engine,sandbox},body.command);
  else if(body.intent==='read')result=await store.read(body.id,body.actorId?{role:'npc',actorId:body.actorId}:{role:'assistant'});
  else if(body.intent==='search')result=await sandbox.grep(body.query,body.actorId?{role:'npc',actorId:body.actorId}:{role:'assistant'});
  else if(body.intent==='edit')result=await store.edit(body.edit,{role:'assistant'});
  else if(body.intent==='context')result=await campaignContext(store,{role:'assistant'});
  else if(body.intent==='create')result=await store.create(body.create,{role:'assistant'});
  else if(body.intent==='ingestEvent')result=await ingestAcceptedEvent(store,body.ingestion,{role:'assistant'});
  else if(body.intent==='saveLocation')result=await saveLocation(store,body.save,{role:'assistant'});
  else if(body.intent==='locationContext')result=await locationContext(store,body.id,{atTurn:body.atTurn??0,authority:{role:'assistant'}});
  else if(body.intent==='sandboxCommand')result=await sandbox.command(body.command,{role:'gm'});
  else if(body.intent==='migrationDryRun')result=await migrationDryRun(store,body.documents);
  else if(body.intent==='export')result={authority:'markdown',documents:(await store.all()).map((row:{text:string})=>row.text)};
  else if(body.intent==='migrationImport')result=await(await migrationFixtureStore()).importBundle(body.import,{role:'assistant'});
  else if(body.intent==='migrationRollback')result=await(await migrationFixtureStore()).rollbackImport(body.rollback,{role:'assistant'});
  else if(body.intent==='undo')result=await store.undo(body.receiptId,body.undo,{role:'assistant'});
  else if(body.intent==='turn')result=await engine.start(body.turn);
  else if(body.intent==='stop')result=await engine.stop(body.id);
  else if(body.intent==='answer')result=await engine.answer(body.id,body.choice);
  else if(body.intent==='dismiss')result=await engine.dismiss(body.id);
  else if(body.intent==='run')result=publicRun(await store.loadRun(body.id));
  else if(body.intent==='decision')result=await groundedDecision(store,{actorId:body.actorId,question:body.question,...(body.observedAction?{observedAction:body.observedAction}:{}),operationId:body.operationId||'ask_'+hash([Date.now(),body.actorId,body.question]).slice(0,40)},engine.transport,{memory:engine.memory});
  else throw Error('Unknown fixture action.');
  return json(result);
 }catch(error:any){return json({error:error.message,code:error.code||'INVALID_REQUEST'},{status:['VERSION_CONFLICT','BUSY'].includes(error.code)?409:400});}
}
