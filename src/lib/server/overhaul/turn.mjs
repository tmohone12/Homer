import {z} from 'zod';
import {StoreError,hash} from './store.mjs';
import {publicRun} from './engine.mjs';
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/);
export async function readCampaignBody(request){const reader=request.body?.getReader();if(!reader)throw new StoreError('INVALID_REQUEST','JSON request required.');const chunks=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){await reader.cancel();throw new StoreError('REQUEST_TOO_LARGE','Request exceeds 64 KiB.');}chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
/** One familiar turn owner for browser and explicitly scoped CLI/MCP clients. */
export async function campaignTurnCommand({engine,store},input){
 const command=z.discriminatedUnion('intent',[
  z.object({intent:z.literal('submit'),turn:z.object({id,action:z.literal('story'),text:z.string().trim().min(1).max(2000),actionType:z.enum(['do','say','think','story','pov','free','ooc']).default('do')}).strict()}).strict(),
  z.object({intent:z.literal('resume'),id}).strict(),z.object({intent:z.literal('stop'),id}).strict(),z.object({intent:z.literal('run'),id}).strict(),z.object({intent:z.literal('answer'),id,choice:z.string().trim().min(1).max(2000)}).strict(),z.object({intent:z.literal('dismiss'),id}).strict(),
 ]).parse(input);
 if(command.intent==='submit')return engine.start(command.turn);
 const run=await store.loadRun(command.id);if(!run||run.request?.action!=='story')throw new StoreError('RUN_SCOPE_DENIED','The familiar turn gateway accepts only campaign story runs.');
 if(command.intent==='resume')return engine.start(run.request);
 if(command.intent==='stop')return engine.stop(command.id);
 if(command.intent==='answer')return engine.answer(command.id,command.choice);
 if(command.intent==='dismiss')return engine.dismiss(command.id);
 return publicRun(run);
}