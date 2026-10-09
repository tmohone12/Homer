import {StoreError} from './store.mjs';
const runId='memweave_actual_invocations_20261008',maximum=12;
const fail=(code,message)=>{throw new StoreError(code,message);};
/** Qualification-only, atomic cross-invocation ledger. Existing attempts are
 * preserved verbatim; opening an already-owned scope or resetting it is denied. */
export async function openMemWeaveInvocationLedger(store,seed,{onUpdate}={}){
 if(seed?.maxInvocations!==maximum||!Array.isArray(seed.attempts)||seed.attempts.length>maximum||seed.attempts.some((a,i)=>a.index!==i+1||!a.finishedAt||!['completed','failed','rejected'].includes(a.status)))fail('MEMORY_LEDGER','Supply a complete retained ledger with the fixed twelve-invocation cap.');
 await store.serial(async()=>{if(await store.loadRun(runId))fail('MEMORY_LEDGER_OWNED','This continuation already owns its invocation scope.');await store.saveRun({...structuredClone(seed),id:runId});});
 let updates=Promise.resolve();const publish=state=>{if(!onUpdate)return Promise.resolve();updates=updates.then(()=>onUpdate(structuredClone(state)));return updates;};
 return {
  snapshot:()=>store.loadRun(runId),
  async run(native,request,options){
   let index;const reserved=await store.serial(async()=>{const state=await store.loadRun(runId);if(state.attempts.length>=maximum)fail('MEMORY_INVOCATION_CAP','All twelve approved invocations are already consumed.');index=state.attempts.length+1;state.attempts.push({index,at:new Date().toISOString(),scope:request.snapshot.scope,query:request.query,snapshotHash:request.snapshot.snapshotHash,status:'dispatched'});await store.saveRun(state);return state;});
   await publish(reserved);let status='failed',code='MEMORY_WORKER_FAILED';
   try{const result=await native(request,options);status='completed';code=null;return result;}catch(error){code=error.code||code;throw error;}finally{
    const done=await store.serial(async()=>{const state=await store.loadRun(runId),entry=state.attempts[index-1];entry.status=status;if(code)entry.code=code;entry.finishedAt=new Date().toISOString();await store.saveRun(state);return state;});await publish(done);
   }
  }
 };
}
