import {z} from 'zod';
import {hash,StoreError} from './store.mjs';
import {MemWeaveAdapter} from './memweave.mjs';
import {createMemWeaveWorker} from './memweaveCoordinator.mjs';
const authoritySchema=z.discriminatedUnion('role',[z.object({role:z.enum(['gm','assistant'])}).strict(),z.object({role:z.literal('npc'),actorId:z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/)}).strict()]);
const metadata=s=>s.records.map(r=>({id:r.id,path:r.path,name:r.name,sha256:r.sha256,revision:r.revision,textHash:hash(r.text)}));
/** Application lifecycle over the existing reviewed isolated process owner.
 * Incremental refresh concerns sealed source coverage/invalidation. The pinned
 * Python worker rebuilds a complete isolated index per query; no persistent or
 * incremental package-index behavior is claimed. No process starts by default. */
export class LifecycleMemory extends MemWeaveAdapter{
 constructor(store,{worker,journalStore=store,scopePolicy='campaign',scopeAuthority,pinned=false,backend}={}){
  super(store,{worker});this.journalStore=journalStore;this.scopePolicy=scopePolicy;this.scopeAuthority=scopeAuthority&&authoritySchema.parse(scopeAuthority);this.pinned=pinned;
  this.backend=backend||{entries:new Map(),refreshes:new Map(),results:new Map(),active:new Map(),worker,mode:worker?'injected':'disabled'};this.name=worker?'MemWeave lifecycle (scoped process binding)':'MemWeave lifecycle (bound; execution disabled, canonical fallback)';
  if(!backend&&store.onCanonicalCommit)store.onCanonicalCommit(async()=>{for(const active of this.backend.active.values())if(!active.adapter.pinned)try{await active.adapter.refresh(active.authority,{reason:'accepted canonical transaction'});}catch(error){await active.adapter.markFailure(active.authority,error);}});
 }
 identity(authority){authority=authoritySchema.parse(authority);if(this.scopeAuthority&&hash(authority)!==hash(this.scopeAuthority))throw new StoreError('KNOWLEDGE_DENIED','Task memory authority is fixed by the app-resolved child scope.');return {authority,key:hash({campaign:this.journalStore.root,branch:'main',authority,scopePolicy:this.scopePolicy})};}
 async refresh(authority,options={}){const {key}=this.identity(authority),prior=this.backend.refreshes.get(key)||Promise.resolve(),next=prior.catch(()=>{}).then(()=>this.refreshSources(authority,options));this.backend.refreshes.set(key,next);try{return await next;}finally{if(this.backend.refreshes.get(key)===next)this.backend.refreshes.delete(key);}}
 async refreshSources(authority,{reason='source validation'}={}){
  const {key,authority:scope}=this.identity(authority);if(!this.backend.entries.has(key)&&this.backend.active.size>=128)throw new StoreError('MEMORY_BUDGET','Campaign memory scope budget exceeded.');
  const snapshot=await super.snapshot(scope),rows=metadata(snapshot),runId='memory_scope_'+key.slice(0,40),saved=this.backend.entries.get(key)||await this.journalStore.loadRun(runId),previous=new Map((saved?.sources||[]).map(r=>[r.id,r])),current=new Map(rows.map(r=>[r.id,r])),delta={added:[],updated:[],renamed:[],removed:[]};
  for(const row of rows){const old=previous.get(row.id);if(!old)delta.added.push(row.id);else if(hash(old)!==hash(row)){delta.updated.push(row.id);if(old.name!==row.name)delta.renamed.push(row.id);}}for(const row of previous.values())if(!current.has(row.id))delta.removed.push(row.id);
  const changed=saved?.snapshotHash!==snapshot.snapshotHash||saved?.execution!==this.backend.mode,value=changed?{...(saved||{}),id:runId,kind:'memory-scope',status:this.worker?'needs-index':'disabled',scope:scope.role==='npc'?'npc:'+scope.actorId:scope.role,scopePolicyHash:hash(this.scopePolicy),scopeIdentity:key,snapshotHash:snapshot.snapshotHash,sources:rows,sourceCount:rows.length,indexedSnapshotHash:saved?.indexedSnapshotHash||null,indexedSourceCount:saved?.indexedSourceCount||0,stale:true,delta,refreshRevision:(saved?.refreshRevision||0)+1,lastRefreshReason:reason,refreshedAt:new Date().toISOString(),indexMode:'complete isolated rebuild per query',packageChunkCoverage:null,execution:this.backend.mode,actualQualificationCap:12,actualQualificationRemaining:0}:saved;
  this.backend.entries.set(key,value);this.backend.active.set(key,{adapter:this,authority:scope});if(changed){for(const cacheKey of this.backend.results.keys())if(cacheKey.startsWith(key+':'))this.backend.results.delete(cacheKey);await this.journalStore.saveRun(value);}return {snapshot,status:value,key};
 }
 async snapshot(authority){return (await this.refresh(authority)).snapshot;}
 async markFailure(authority,error){const {key}=this.identity(authority),value=this.backend.entries.get(key);if(!value)return;const failed={...value,status:'degraded',stale:true,lastError:{code:error.code||'MEMORY_WORKER_FAILED',message:'Index/worker unavailable; canonical scoped fallback remains active.'},failedAt:new Date().toISOString()};this.backend.entries.set(key,failed);await this.journalStore.saveRun(failed);}
 async recall(query,authority,{signal}={}){
  z.string().trim().min(1).max(300).parse(query);if(signal?.aborted)throw new StoreError('CANCELLED','Memory lookup stopped.');const {snapshot,key}=await this.refresh(authority),cacheKey=key+':'+hash({query,snapshotHash:snapshot.snapshotHash}),cached=this.backend.results.get(cacheKey);if(cached)return {...structuredClone(cached),lifecycle:{...(await this.status(authority)),replayed:true}};
  const answer=await super.recall(query,authority,{signal});if(signal?.aborted)throw new StoreError('CANCELLED','Late memory response discarded.');const current=await this.refresh(authority);
  if(current.snapshot.snapshotHash!==snapshot.snapshotHash){await this.markFailure(authority,new StoreError('MEMORY_STALE','Sources changed while indexing.'));return {...await this.store.search(query,authority,{limit:12}),adapter:'MemWeave lifecycle canonical fallback',degraded:true,stale:true,reason:'MEMORY_STALE',lifecycle:await this.status(authority)};}
  if(answer.degraded&&this.worker){await this.markFailure(authority,new StoreError(answer.reason||'MEMORY_DISABLED','Worker degraded.'));}
  else if(!answer.degraded){const value={...this.backend.entries.get(key),status:'indexed',stale:false,indexedSnapshotHash:snapshot.snapshotHash,indexedSourceCount:snapshot.records.length,lastError:null,indexedAt:new Date().toISOString()};this.backend.entries.set(key,value);await this.journalStore.saveRun(value);if(this.backend.results.size>=64)this.backend.results.delete(this.backend.results.keys().next().value);this.backend.results.set(cacheKey,structuredClone(answer));}
  return {...answer,lifecycle:await this.status(authority)};
 }
 async status(authority={role:'assistant'}){const {status}=await this.refresh(authority);const {sources,...value}=status;return {...value,bindingInstalled:true,indexResident:false,workerExecutionEnabled:Boolean(this.worker),coveredSourceCount:sources.length,coverage:'Validated sealed source coverage; package chunk counts are not reported.'};}
 fork(scopedStore,{scopePolicy,authority,pinned=true}={}){return new LifecycleMemory(scopedStore,{worker:this.worker,journalStore:this.journalStore,scopePolicy:scopePolicy||'restricted',scopeAuthority:authority,pinned,backend:this.backend});}
}

/** Host-only injection, never API settings. Recorded process transport uses the
 * exact reviewed coordinator with fake child processes. Native dispatch also
 * requires the existing capped invocation guard; no guard or exhausted ledger
 * means no native process. The preview provides neither grant nor guard. */
export function bindCampaignMemory(store,{workRoot,memoryWorker,memoryRuntime}={}){
 let worker=memoryWorker,mode=worker?'injected':'disabled';
 if(memoryRuntime){const recorded=memoryRuntime.processTransport?.mode==='recorded';if(recorded&&typeof memoryRuntime.processTransport.spawnProcess!=='function')throw new StoreError('MEMORY_RUNTIME','Recorded process transport needs a private spawn function.');const permitted=recorded||memoryRuntime.allowExecution===true&&typeof memoryRuntime.invocationGuard?.run==='function';const native=createMemWeaveWorker({workRoot,reviewedRuntime:memoryRuntime.reviewedRuntime,allowExecution:permitted,...(recorded?{spawnProcess:memoryRuntime.processTransport.spawnProcess}:{}),...(memoryRuntime.bounds||{})});if(permitted){worker=(request,options)=>recorded?native(request,options):memoryRuntime.invocationGuard.run(native,request,options);mode=recorded?'recorded-process':'guarded-native';}}
 const memory=new LifecycleMemory(store,{worker});memory.backend.mode=mode;return memory;
}
