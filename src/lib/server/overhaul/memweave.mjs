import {z} from 'zod';import {StoreError,hash} from './store.mjs';
export const MEMWEAVE_SOURCE={repository:'https://github.com/sachinsharma9780/memweave',commit:'2ff82df7148274ee7d465273e2c401be18625238',package:'memweave',version:'0.2.1',python:'>=3.12,<4',license:'MIT'};
const querySchema=z.string().trim().min(1).max(300);
const searchResult=z.object({path:z.string().regex(/^records\/[a-z][a-z0-9_-]{0,79}\.md$/),start_line:z.number().int().positive(),end_line:z.number().int().positive(),score:z.number().finite().nonnegative(),snippet:z.string().max(4000),source:z.string().max(100),vector_score:z.number().finite().nullable().optional(),text_score:z.number().finite().nullable().optional()}).strict();
/** Injected worker receives a sealed actor-filtered snapshot, never a host path or live vault.
 * No subprocess or library is installed/launched by this adapter. Default is canonical fallback. */
export class MemWeaveAdapter {
 constructor(store,{worker}={}){this.store=store;this.worker=worker;this.name='MemWeave adapter (disabled; canonical fallback)';}
 async snapshot(authority){
  const rows=await this.store.list(authority),records=[];
  for(const row of rows){const source=await this.store.read(row.id,authority);records.push({id:row.id,path:source.path,text:source.markdown,sha256:source.hash,revision:source.record.revision,name:source.record.name});}
  if(records.length>500||Buffer.byteLength(JSON.stringify(records))>8*1024*1024)throw new StoreError('MEMORY_BUDGET','Memory snapshot exceeds campaign bounds.');
  return {records,scope:authority.role==='npc'?'npc:'+authority.actorId:authority.role,snapshotHash:hash(records)};
 }
 async recall(query,authority,{signal}={}){
  querySchema.parse(query);if(signal?.aborted)throw new StoreError('CANCELLED','Memory recall stopped.');
  if(!this.worker)return {...await this.store.search(query,authority,{limit:12}),adapter:this.name,degraded:true,reason:'MemWeave worker is not enabled in this runtime',stale:false};
  const snapshot=await this.snapshot(authority),request={operation:'search',query,max_results:12,snapshot,source:MEMWEAVE_SOURCE,policy:{network:'none',credentials:'absent',vector:false,embedding:'no-network-empty-provider',flush:false,watcher:false,canonicalWrites:false,strategy:'keyword'}};
  try{
   // The worker boundary must enforce these settings outside Python as well. A mock report is not execution proof.
   const output=await this.worker(request,{signal});if(signal?.aborted)throw new StoreError('CANCELLED','Memory recall stopped.');
   if(output.policy?.network!=='none'||output.policy?.credentials!=='absent'||output.policy?.flush!==false||output.policy?.canonicalWrites!==false||output.sourceCommit!==MEMWEAVE_SOURCE.commit)throw new StoreError('MEMORY_POLICY','MemWeave worker failed the required pinned no-network policy.');
   if(output.snapshotHash!==snapshot.snapshotHash)throw new StoreError('MEMORY_STALE','Memory index does not describe this scope snapshot.');
   const results=z.array(searchResult).max(12).parse(output.results),matches=[];let stale=false;
   for(const result of results){const source=snapshot.records.find(record=>record.path===result.path);if(!source)throw new StoreError('KNOWLEDGE_DENIED','Memory worker returned a source outside the actor scope.');const current=await this.store.read(source.id,authority);if(current.hash!==source.sha256){stale=true;continue;}const lines=source.text.split('\n');if(result.end_line<result.start_line||result.end_line>lines.length||result.end_line-result.start_line>100)throw new StoreError('MEMORY_PROTOCOL','Invalid source line span.');const text=lines.slice(result.start_line-1,result.end_line).join('\n').slice(0,700);matches.push({id:source.id,name:source.name,path:source.path,line:result.start_line,endLine:result.end_line,lineKind:authority.role==='npc'?'actor-view':'canonical',hash:source.sha256,revision:source.revision,text,score:result.score});}
   return {query,matches,adapter:'MemWeave pinned worker',source:MEMWEAVE_SOURCE,degraded:stale,stale,reason:stale?'Canonical sources changed; stale matches excluded':null};
  }catch(error){if(signal?.aborted||error.code==='CANCELLED')throw error;return {...await this.store.search(query,authority,{limit:12}),adapter:'MemWeave canonical fallback',degraded:true,stale:error.code==='MEMORY_STALE',reason:error.code||'MEMORY_WORKER_FAILED'};}
 }
}