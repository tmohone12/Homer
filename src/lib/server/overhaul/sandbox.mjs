import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {hash,StoreError,parseMarkdown,renderMarkdown,validateRecord} from './store.mjs';
import {patchCandidate} from './workflows.mjs';
export const SANDBOX_IMAGE='sha256:8b81dd37ff027bec4e516d41acfbe9fe2460070dc6d4a4570a2ac5b9d59df065';
export const SANDBOX_HOST='npipe:////./pipe/dockerDesktopLinuxEngine';
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
const requestSchema=z.object({id,argv:z.array(z.string().max(16000)).min(1).max(32),timeoutMs:z.number().int().min(100).max(5000).default(3000),apply:z.boolean().default(true),evidenceIds:z.array(id).max(50).default([])}).strict();
const activeSessions=new Set();
const fail=(code,message)=>{throw new StoreError(code,message);};
const policy={implementation:'Docker Desktop Linux container',image:SANDBOX_IMAGE,network:'none',user:'65534:65534',rootReadOnly:true,capabilities:'ALL dropped',noNewPrivileges:true,cpu:0.5,memoryBytes:67108864,pids:16,workspaceBytes:16777216,tmpBytes:1048576,commandTimeoutMaxMs:5000,outputBytes:65536,canonicalWrites:'validated campaign writer only'};
function leafPatch(before,after){
 const patch={};for(const [key,value]of Object.entries(after.data)){const old=before.data[key];if(value&&typeof value==='object'&&!Array.isArray(value)&&old&&typeof old==='object'&&!Array.isArray(old)){for(const [nested,next]of Object.entries(value))if(hash(next)!==hash(old[nested]))patch['data.'+key+'.'+nested]=next;}else if(hash(value)!==hash(old??null))patch['data.'+key]=value;}
 for(const key of Object.keys(before.data))if(!Object.hasOwn(after.data,key))fail('FIELD_DENIED','Commands cannot remove schema fields.');return patch;
}
export class CampaignSandbox{
 constructor(store){this.store=store;this.name='Campaign Docker sandbox with BusyBox grep';}
 async initialize(){
  if(process.platform!=='win32')fail('SANDBOX_UNAVAILABLE','This qualified adapter requires the verified Windows Docker Desktop Linux endpoint.');
  await this.store.checkInternal('.journal');
  for(const dir of ['.journal/sandbox-seeds','.journal/docker-config']){try{await fs.mkdir(path.join(this.store.root,dir));}catch(e){if(e.code!=='EEXIST')throw e;}await this.store.checkInternal(dir);}
  this.config=path.join(this.store.root,'.journal/docker-config');
 }
 async docker(args,{timeoutMs=10000,maxOutput=65536,signal}={}){
  const env=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  return new Promise((resolve,reject)=>{
   const child=spawn('docker',['--host',SANDBOX_HOST,'--config',this.config,...args],{shell:false,windowsHide:true,env});
   const chunks={stdout:[],stderr:[]};let bytes=0,limit=null;
   const stop=reason=>{limit=reason;child.kill();};
   const timer=setTimeout(()=>stop('TIME_LIMIT'),timeoutMs),abort=()=>stop('CANCELLED');
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   for(const kind of ['stdout','stderr'])child[kind].on('data',chunk=>{bytes+=chunk.length;if(bytes>maxOutput)stop('OUTPUT_LIMIT');else chunks[kind].push(chunk);});
   child.on('error',error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new StoreError('SANDBOX_UNAVAILABLE',error.message));});
   child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve({code,stdout:Buffer.concat(chunks.stdout).toString('utf8'),stderr:Buffer.concat(chunks.stderr).toString('utf8'),limit,bytes});});
  });
 }
 async verifyContainer(containerId){
  const inspect=await this.docker(['inspect',containerId,'--format','{{json .HostConfig}}']);
  if(inspect.code!==0)fail('SANDBOX_UNAVAILABLE','Cannot verify container enforcement.');
  const c=JSON.parse(inspect.stdout);
  if(c.NetworkMode!=='none'||c.ReadonlyRootfs!==true||c.Privileged||c.Memory!==policy.memoryBytes||c.PidsLimit!==16||c.NanoCpus!==500000000||!c.CapDrop?.includes('ALL')||!c.SecurityOpt?.some(value=>value.startsWith('no-new-privileges'))||!c.Tmpfs?.['/workspace']?.includes('size=16m'))fail('SANDBOX_POLICY_MISMATCH','Container confinement did not match policy.');
  const details=await this.docker(['inspect',containerId,'--format','{{json .Config.User}} {{json .Mounts}}']);
  const newline=details.stdout.trim(),space=newline.indexOf(' '),user=JSON.parse(newline.slice(0,space)),mounts=JSON.parse(newline.slice(space+1));
  if(user!=='65534:65534'||mounts.some(m=>m.Type==='bind'&&(m.Destination!=='/seed'||m.RW))||mounts.some(m=>m.Type==='volume'))fail('SANDBOX_POLICY_MISMATCH','Unexpected user or host mount.');
  return {...policy,verified:true};
 }
 async command(input,authority,options={}){
  if(activeSessions.has(this.store.root))fail('BUSY','One command session per campaign at a time.');
  activeSessions.add(this.store.root);try{return await this.executeCommand(input,authority,options);}finally{activeSessions.delete(this.store.root);}
 }
 async executeCommand(input,authority,{signal}={}){
  if(!['gm','assistant'].includes(authority?.role))fail('SCOPE_DENIED','Commands are a scoped GM/author capability.');
  const request=requestSchema.parse(input);if(!/^(?:\/[a-zA-Z0-9_./-]+|[a-zA-Z][a-zA-Z0-9_.-]*)$/.test(request.argv[0]))fail('COMMAND_INVALID','Use an executable inside the container.');
  const fingerprint=hash({request,authority}),runId='sandbox_'+hash(request.id).slice(0,40);
  await this.initialize();
  let run=await this.store.serial(async()=>{const prior=await this.store.loadRun(runId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Sandbox tool ID reused.');return prior;}const next={id:runId,kind:'sandbox-tool',fingerprint,request,authority,status:'running',policy,at:new Date().toISOString()};await this.store.saveRun(next);return next;});
  if(run.status==='completed'&&!request.apply&&['CANCELLED','TIME_LIMIT'].includes(run.output?.limit)){run.attempts=[...(run.attempts||[]),run.output];run.status='running';run.started=false;await this.store.serial(()=>this.store.saveRun(run));}
  if(run.status==='completed')return {...run,replayed:true};
  if(run.status==='running'&&run.started)fail('INTERRUPTED_COMMAND','Command outcome is unknown; do not silently rerun side effects.');
  if(run.status!=='command-completed'){
   run.started=true;await this.store.serial(()=>this.store.saveRun(run));
   const sessionId='gm-'+randomUUID(),seed=path.join(this.store.root,'.journal/sandbox-seeds',sessionId);
   await fs.mkdir(seed);await this.store.checkInternal('.journal/sandbox-seeds/'+sessionId);await fs.mkdir(path.join(seed,'records'));
   const rows=await this.store.all(),visible=rows.filter(row=>this.store.visible(row.record,authority));const sourceRows=new Map(visible.map(row=>[row.record.id,row]));
   for(const row of visible)await fs.writeFile(path.join(seed,'records',row.record.id+'.md'),['gm','assistant'].includes(authority.role)?row.text:renderMarkdown(this.store.view(row.record,authority)),{flag:'wx'});
   let containerId;
   try{
    const launch=await this.docker(['run','--rm','--detach','--pull','never','--name','myth-'+sessionId,'--label','mythengine.gm-session='+runId,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65534:65534','--memory','64m','--cpus','0.5','--pids-limit','16','--tmpfs','/workspace:rw,nosuid,nodev,size=16m,mode=1777','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=1m,mode=1777','--tmpfs','/data:rw,noexec,nosuid,nodev,size=1m,mode=1777','--mount','type=bind,source='+seed+',target=/seed,readonly','--workdir','/workspace','--entrypoint','/bin/sh',SANDBOX_IMAGE,'-c','cp -R /seed/. /workspace/ && exec sleep 45'],{signal});
    if(launch.code!==0||!(/^[a-f0-9]{64}$/.test(launch.stdout.trim())))fail('SANDBOX_UNAVAILABLE','Cached sandbox runtime cannot launch: '+launch.stderr.slice(0,500));
    containerId=launch.stdout.trim();run.containerId=containerId;run.policy=await this.verifyContainer(containerId);
    // Readiness comes from a container-local marker, never a host security change.
    const ready=await this.docker(['exec',containerId,'/bin/sh','-c','test -d /workspace/records']);
    if(ready.code!==0)fail('SANDBOX_UNAVAILABLE','Campaign snapshot is not ready.');
    const output=await this.docker(['exec','--user','65534:65534',containerId,'timeout','-s','KILL',String(Math.max(1,Math.ceil(request.timeoutMs/1000))),...request.argv],{timeoutMs:request.timeoutMs+1500,signal});
    run.output=output;run.patches=[];run.sourceHashes=Object.fromEntries(visible.map(row=>[row.record.id,row.hash]));
    if(request.apply&&output.code===0&&!output.limit){
     const listing=await this.docker(['exec',containerId,'/bin/sh','-c','test ! -L /workspace/records || exit 90; for f in records/*; do test ! -L "$f" && test -f "$f" && test "$(stat -c %h "$f")" = 1 || exit 90; sha256sum "$f"; done']);
     if(listing.code!==0||listing.limit)fail('PATH_DENIED','Cannot enumerate command edits safely.');
     const names=listing.stdout.trim().split('\n').filter(Boolean);if(names.length!==visible.length)fail('FIELD_DENIED','Use validated create/undo tools to add or remove canonical files.');
     let bytes=0,changed=0;
     for(const entry of names){
      const digest=entry.match(/^([a-f0-9]{64})  records\/([a-z][a-z0-9_-]{0,79})\.md$/);if(!digest||!sourceRows.has(digest[2]))fail('PATH_DENIED','Unexpected record target.');
      if(digest[1]===sourceRows.get(digest[2]).hash)continue;
      if(++changed>20)fail('BUDGET_EXCEEDED','At most twenty changed records per command.');
      const name='/workspace/records/'+digest[2]+'.md',match=[name,digest[2]];
      const read=await this.docker(['exec',containerId,'/bin/sh','-c','test ! -L /workspace/records && test ! -L "$1" && test -f "$1" && test "$(stat -c %h "$1")" = 1 && cat "$1"','read-scoped-file',name],{maxOutput:1024*1024});
      if(read.code!==0||read.limit)fail('PATH_DENIED','Linked or oversized record edit denied.');bytes+=Buffer.byteLength(read.stdout);if(bytes>8*1024*1024)fail('BUDGET_EXCEEDED','Candidate campaign exceeds 8 MiB.');
      const before=sourceRows.get(match[1]),candidate=parseMarkdown(read.stdout);
      if(candidate.gmContextMode!==before.record.gmContextMode)fail('FIELD_DENIED','GM context controls use the explicit author tool.');
      if(candidate.id!==before.record.id||candidate.type!==before.record.type||candidate.name!==before.record.name||candidate.visibility!==before.record.visibility||candidate.revision!==before.record.revision)fail('FIELD_DENIED','Commands cannot change record identity, type, visibility or revision.');
      const patch=leafPatch(before.record,candidate);
      if(Object.keys(patch).length){patchCandidate(before.record,patch);await this.store.validateReferences(candidate,rows);if(authority.role==='gm'){const events=rows.filter(row=>request.evidenceIds.includes(row.record.id)&&row.record.type==='event').map(row=>row.record);for(const [field,value]of Object.entries(patch))if(!events.some(event=>event.data.assertions.some(a=>a.subjectId===candidate.id&&a.field===field&&hash(a.value)===hash(value))))fail('EVIDENCE_REQUIRED','Command edit lacks an accepted source assertion.');}run.patches.push({id:candidate.id,operationId:'cmd_'+hash([runId,candidate.id]).slice(0,40),expectedHash:before.hash,patch,evidenceIds:request.evidenceIds});}
     }
    }
    run.status='command-completed';await this.store.serial(()=>this.store.saveRun(run));
   }catch(error){run.status='failed';run.error={code:error.code||'SANDBOX_FAILED',message:error.message};await this.store.serial(()=>this.store.saveRun(run));throw error;}
   finally{
    if(containerId){const label=await this.docker(['inspect',containerId,'--format','{{index .Config.Labels "mythengine.gm-session"}}']);if(label.stdout.trim()===runId)await this.docker(['rm','--force',containerId]);}
    for(const row of visible){const relative='.journal/sandbox-seeds/'+sessionId+'/records/'+row.record.id+'.md';await this.store.checkInternal(relative);await fs.unlink(path.join(this.store.root,relative));}
    await this.store.checkInternal('.journal/sandbox-seeds/'+sessionId+'/records');await fs.rmdir(path.join(seed,'records'));await this.store.checkInternal('.journal/sandbox-seeds/'+sessionId);await fs.rmdir(seed);

   }
  }
  run.receipts=[];for(const edit of run.patches||[])run.receipts.push(await this.store.edit(edit,authority));
  run.status='completed';run.completedAt=new Date().toISOString();await this.store.serial(()=>this.store.saveRun(run));return run;
 }
 async grep(query,authority,{operationId='grep_'+randomUUID().replaceAll('-',''),signal}={}){
  if(typeof query!=='string'||!query.trim()||query.length>300)fail('QUERY_INVALID','Use a literal query of 1-300 characters.');
  // NPC gets an actor-filtered snapshot through the scoped read adapter; it has
  // no general command or GM snapshot capability.
  if(authority?.role==='npc'||authority?.role==='player')return {...await this.store.search(query,authority),implementation:'actor-filtered search; command capability denied'};
  const run=await this.command({id:operationId,argv:['grep','-H','-n','-i','-F','-r','--',query,'records'],apply:false},authority,{signal});
  if(run.output.limit||![0,1].includes(run.output.code))fail(run.output.limit||'GREP_FAILED','Sandbox grep did not complete within its limits.');
  const matches=run.output.stdout.split('\n').filter(Boolean).map(line=>{const match=line.match(/^(records\/([a-z][a-z0-9_-]{0,79})\.md):(\d+):(.*)$/);if(!match)fail('GREP_FAILED','Unexpected grep output.');return {id:match[2],path:match[1],line:Number(match[3]),lineKind:'source',name:match[2],text:match[4].slice(0,500),hash:run.sourceHashes[match[2]]};}).slice(0,30);
  return {matches,truncated:run.output.stdout.split('\n').filter(Boolean).length>30,implementation:'BusyBox grep inside verified campaign container',sessionId:run.id,policy:run.policy};
 }
}
