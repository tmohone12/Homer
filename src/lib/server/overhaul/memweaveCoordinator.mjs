import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {spawn as nativeSpawn} from 'node:child_process';import {z} from 'zod';
import {MEMWEAVE_SOURCE} from './memweave.mjs';import {hash,StoreError} from './store.mjs';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
const record=z.object({id,path:z.string(),text:z.string().max(1048576),sha256:sha,revision:z.number().int().positive(),name:z.string().max(200)}).strict();
const policy={network:'none',credentials:'absent',vector:false,embedding:'no-network-empty-provider',flush:false,watcher:false,canonicalWrites:false,strategy:'keyword'};
const requestSchema=z.object({operation:z.literal('search'),query:z.string().trim().min(1).max(300),max_results:z.number().int().min(1).max(12),snapshot:z.object({scope:z.string().regex(/^(gm|assistant|npc:[a-z][a-z0-9_-]{0,79})$/),snapshotHash:sha,records:z.array(record).max(500)}).strict(),source:z.object(Object.fromEntries(Object.entries(MEMWEAVE_SOURCE).map(([key,value])=>[key,z.literal(value)]))).strict(),policy:z.object(Object.fromEntries(Object.entries(policy).map(([key,value])=>[key,z.literal(value)]))).strict()}).strict();
const resultSchema=z.object({path:z.string(),start_line:z.number().int().positive(),end_line:z.number().int().positive(),score:z.number().finite().nonnegative(),snippet:z.string().max(4000),source:z.string().max(100),vector_score:z.number().finite().nullable().optional(),text_score:z.number().finite().nullable().optional()}).strict();
const outputSchema=z.object({snapshotHash:sha,sourceCommit:z.literal(MEMWEAVE_SOURCE.commit),policy:z.object({network:z.literal('none'),credentials:z.literal('absent'),flush:z.literal(false),canonicalWrites:z.literal(false)}).strict(),results:z.array(resultSchema).max(12)}).strict();
function deny(code,message){throw new StoreError(code,message);}
/** Treat package chunks as candidate ranges, then emit one bounded canonical
 * excerpt per hit. Validate the original range before narrowing it: truncation
 * can never sanitize an outside path or an out-of-file endpoint. */
export function boundWorkerAnswer(input,request){
 const answer=outputSchema.parse(input);
 if(answer.snapshotHash!==request.snapshot.snapshotHash)deny('MEMORY_STALE','Memory snapshot changed.');
 if(answer.results.length>request.max_results)deny('MEMORY_PROTOCOL','Memory result count exceeds its request.');
 const sources=new Map(request.snapshot.records.map(row=>[row.path,row.text.split('\n')])),needle=request.query.toLowerCase(),terms=needle.match(/[\p{L}\p{N}_]+/gu)||[];
 const ranges=answer.results.map(hit=>{const lines=sources.get(hit.path);if(!lines||hit.end_line<hit.start_line||hit.end_line>lines.length)deny('MEMORY_SCOPE','Memory response escaped its sealed source.');return {hit,lines};});
 answer.results=ranges.map(({hit,lines})=>{
  let start=hit.start_line,end=hit.end_line;
  if(end-start>=100){const within=lines.slice(start-1,end);let offset=within.findIndex(line=>line.toLowerCase().includes(needle));if(offset<0&&terms.length)offset=within.findIndex(line=>{const lower=line.toLowerCase();return terms.some(term=>lower.includes(term));});if(offset>=0)start+=offset;end=Math.min(end,start+99);}
  return {...hit,start_line:start,end_line:end,snippet:lines.slice(start-1,end).join('\n').slice(0,4000)};
 });
 if(Buffer.byteLength(JSON.stringify(answer))>256*1024)deny('MEMORY_OUTPUT','Bounded memory output exceeds its limit.');
 return answer;
}
export function validateWorkerRequest(input){const req=requestSchema.parse(input);req.snapshot.records=structuredClone(input.snapshot.records);if(hash(req.snapshot.records)!==req.snapshot.snapshotHash)deny('MEMORY_STALE','Snapshot hash does not match sealed records.');if(Buffer.byteLength(JSON.stringify(req.snapshot.records))>8*1024*1024||Buffer.byteLength(JSON.stringify(req))>9*1024*1024)deny('MEMORY_BUDGET','Memory snapshot/request is too large.');const names=new Set();for(const row of req.snapshot.records){if(row.path!=='records/'+row.id+'.md'||names.has(row.id))deny('MEMORY_SCOPE','Invalid or duplicate sealed source path.');if(Buffer.byteLength(row.text)>1048576)deny('MEMORY_BUDGET','A sealed Markdown record exceeds one MiB.');names.add(row.id);}return req;}
export function workerDockerArguments({name,snapshot,image}){if(!/^myth-mw-[a-f0-9-]{36}$/.test(name)||!/^(?:mythengine-memweave-reviewed@)?sha256:[a-f0-9]{64}$/.test(image))deny('MEMORY_RUNTIME','Only a reviewed final dependency-image digest is admitted.');return ['run','--rm','--pull=never','--name',name,'-i','--platform=linux/amd64','--network=none','--read-only','--user=65534:65534','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=256m','--cpus=0.5','--pids-limit=32','--tmpfs=/index:rw,noexec,nosuid,nodev,size=64m,mode=1777','--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777','--mount=type=bind,source='+snapshot+',target=/workspace/campaign,readonly','--env=MYTHENGINE_REVIEWED_MEMWEAVE_WORKER='+MEMWEAVE_SOURCE.commit,'--entrypoint=python',image,'-I','/app/memweave-worker.py'];}
async function safeDirectory(workRoot,relative){const root=await fs.realpath(workRoot);let target=root;for(const part of relative.split('/')){target=path.join(target,part);await fs.mkdir(target,{recursive:false,mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const info=await fs.lstat(target);if(info.isSymbolicLink()||!info.isDirectory()||await fs.realpath(target)!==target)deny('MEMORY_SCOPE','Snapshot parent may not be a link.');}return target;}
function launch(spawnProcess,executable,args,env){const child=spawnProcess(executable,args,{shell:false,windowsHide:true,env,stdio:['pipe','pipe','pipe']});let settled=false;const closed=new Promise(resolve=>{child.once('error',()=>{if(!settled){settled=true;resolve({error:true});}});child.once('close',(code,signal)=>{if(!settled){settled=true;resolve({code,signal});}});});return {child,closed};}
async function reap(process,timeoutMs){process.child.kill('SIGKILL');let timer;const closed=await Promise.race([process.closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);clearTimeout(timer);if(!closed)deny('MEMORY_REAP','Memory process did not reap within its bound.');return closed;}
/** Default execution is denied. Private reviewedRuntime, explicit host grant and an exact local
 * dependency image are required; neither preview nor browser/MCP parameters expose this owner.
 * Tests inject fake processes; no reviewed package/image is executed by qualification. */
export function createMemWeaveWorker({workRoot,reviewedRuntime,allowExecution=false,dockerExecutable='docker',spawnProcess=nativeSpawn,timeoutMs=10000,reapMs=2000,cleanupMs=2000}={}){
 let active=0;if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||!Number.isInteger(reapMs)||reapMs<1||reapMs>2000||!Number.isInteger(cleanupMs)||cleanupMs<1||cleanupMs>2000)deny('MEMORY_BUDGET','Runtime bounds may only decrease.');
 return async(input,{signal}={})=>{
  if(!allowExecution)deny('MEMORY_DISABLED','Actual MemWeave execution is not authorized.');if(!reviewedRuntime||reviewedRuntime.sourceCommit!==MEMWEAVE_SOURCE.commit||!sha.safeParse(reviewedRuntime.lockSha256).success||!sha.safeParse(reviewedRuntime.workerSha256).success)deny('MEMORY_RUNTIME','Reviewed runtime provenance is missing.');
  const req=validateWorkerRequest(input);workerDockerArguments({name:'myth-mw-'+randomUUID(),snapshot:'validation-only',image:reviewedRuntime.image});
  if(signal?.aborted)deny('CANCELLED','Memory recall stopped.');if(active>=2)deny('MEMORY_BUSY','At most two isolated memory workers may run concurrently.');active++;
  let dir,process,confirmedRemoved=false;const name='myth-mw-'+randomUUID();
  try{
   const root=await fs.realpath(workRoot),lock=await fs.readFile(path.join(root,'memweave-runtime','requirements.lock')),worker=await fs.readFile(path.join(root,'scripts','memweave-worker.py'));
   if(createHash('sha256').update(lock).digest('hex')!==reviewedRuntime.lockSha256||createHash('sha256').update(worker).digest('hex')!==reviewedRuntime.workerSha256)deny('MEMORY_RUNTIME','Reviewed lock or worker changed.');
   const parent=await safeDirectory(root,'fixture-data/memweave-snapshots');dir=await fs.mkdtemp(path.join(parent,'scope-'));await fs.chmod(dir,0o755);await fs.mkdir(path.join(dir,'records'));await fs.mkdir(path.join(dir,'docker-config'));for(const row of req.snapshot.records)await fs.writeFile(path.join(dir,row.path),row.text,{flag:'wx',mode:0o644});
   // Private empty Docker config/home; no inherited provider/proxy/cloud/DOCKER_HOST values.
   const env={DOCKER_CONFIG:path.join(dir,'docker-config'),HOME:dir,USERPROFILE:dir,PATH:path.dirname(dockerExecutable),...(processPlatformEnv())};
   if(signal?.aborted)deny('CANCELLED','Memory recall stopped.');
   process=launch(spawnProcess,dockerExecutable,workerDockerArguments({name,snapshot:dir,image:reviewedRuntime.image}),env);
   const output=[],errors=[];let bytes=0,errorBytes=0,timer,abortListener;let rejectBound;
   const bound=new Promise((_,reject)=>{rejectBound=reject;timer=setTimeout(()=>reject(new StoreError('MEMORY_TIMEOUT','Memory worker timed out.')),timeoutMs);abortListener=()=>reject(new StoreError('CANCELLED','Memory recall stopped.'));signal?.addEventListener('abort',abortListener,{once:true});});
   process.child.stdout.on('data',chunk=>{const data=Buffer.from(chunk);bytes+=data.length;if(bytes>256*1024)rejectBound(new StoreError('MEMORY_OUTPUT','Memory output exceeds its bound.'));else output.push(data);});process.child.stderr.on('data',chunk=>{const data=Buffer.from(chunk);errorBytes+=data.length;if(errorBytes>32*1024)rejectBound(new StoreError('MEMORY_OUTPUT','Memory diagnostics exceed their bound.'));else errors.push(data);});process.child.stdin.on('error',()=>rejectBound(new StoreError('MEMORY_PROCESS','Memory stdin failed.')));
   if(signal?.aborted)abortListener();process.child.stdin.end(JSON.stringify(req)+'\n');
   try{const status=await Promise.race([process.closed,bound]);if(status.error||status.code!==0)deny('MEMORY_PROCESS','Memory worker failed.');const text=Buffer.concat(output).toString('utf8').trim();if(!text||text.includes('\n'))deny('MEMORY_PROTOCOL','Expected one bounded worker response.');let answer;try{answer=outputSchema.parse(JSON.parse(text));}catch{deny('MEMORY_PROTOCOL','Malformed memory response.');}return boundWorkerAnswer(answer,req);
   }catch(error){await reap(process,reapMs);throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abortListener);}
  }finally{
   try{if(process){const env={DOCKER_CONFIG:path.join(dir,'docker-config'),HOME:dir,USERPROFILE:dir,PATH:path.dirname(dockerExecutable),...(processPlatformEnv())};const cleanup=launch(spawnProcess,dockerExecutable,['rm','--force',name],env);let err='',overflow=false;cleanup.child.stdout.on('data',()=>{});cleanup.child.stderr.on('data',chunk=>{if(err.length<4096)err+=String(chunk).slice(0,4096-err.length);else overflow=true;});cleanup.child.stdin.end();let timer;const status=await Promise.race([cleanup.closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),cleanupMs);})]);clearTimeout(timer);if(!status){await reap(cleanup,reapMs);deny('MEMORY_CLEANUP','Container cleanup timed out; sealed snapshot retained.');}if(status.error||overflow||status.code!==0&&!/No such container/i.test(err))deny('MEMORY_CLEANUP','Container removal unconfirmed; sealed snapshot retained.');confirmedRemoved=true;}else confirmedRemoved=true;
    if(dir&&confirmedRemoved){const parent=path.resolve(workRoot,'fixture-data','memweave-snapshots');if(path.dirname(dir)!==parent||!path.basename(dir).startsWith('scope-'))deny('MEMORY_SCOPE','Cleanup path escaped its owner.');await fs.rm(dir,{recursive:true,force:true});}
   }finally{active--;}
  }
 };
}
function processPlatformEnv(){return process.platform==='win32'?{SystemRoot:process.env.SystemRoot||'C:\\Windows',WINDIR:process.env.WINDIR||'C:\\Windows'}:{};}