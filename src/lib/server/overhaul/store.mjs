import {cultureDataSchema,cultureCharacterFields,cultureAccess,filterCultureData,cultureReferences,validateCultureGraph,cultureSources,syncCultureSourceRevision} from './cultureSchemas.mjs';
import {relationshipAppraisalSchema} from './appraisalSchemas.mjs';
import {runFenceFor} from './runFence.mjs';
import fs from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {campaignSchema,chapterSchema,factionSchema,assetSchema,playerSheetSchema} from './controlSchemas.mjs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {locationLoreSchema} from '../../contracts/locationLore.ts';
import {contextModeSchema} from '../../contracts/contentContext.ts';
import {knowledgeClaimSchema,politicsSchema,resourceDataSchema,domainVersionProblems} from './domainSchemas.mjs';

const id=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),reference=id.nullable(),strings=z.array(z.string().max(4000)).max(100);
const claim=knowledgeClaimSchema;
const relationship=z.object({appraisalState:relationshipAppraisalSchema.optional(),targetId:id,bond:z.string().max(1000),knownBy:z.array(id),evidenceIds:z.array(id),visibility:z.enum(['public','secret'])}).strict();
const assertion=z.object({subjectId:id,field:z.string().max(100),value:z.unknown(),kind:z.enum(['detail','event','correction'])}).strict();
export const loreFactSchema=z.object({id,title:z.string().trim().min(1).max(240),statement:z.string().trim().min(1).max(12000),locationLore:locationLoreSchema,validFromTurn:z.number().int().nonnegative().optional(),validToTurn:z.number().int().nonnegative().nullable().optional()}).strict();
export const dataSchemas={campaign:campaignSchema,chapter:chapterSchema,faction:factionSchema,asset:assetSchema,
 culture:cultureDataSchema,character:z.object({...cultureCharacterFields,traits:strings.optional(),background:z.string().max(12000),appearance:z.string().max(4000),current:z.object({locationId:reference,roleTitle:z.string().max(500),condition:z.string().max(1000),allegianceHouseId:reference}).strict(),goals:strings,house:z.object({birthId:reference,currentId:reference,swornId:reference}).strict(),identity:z.object({parentIds:z.array(id),originId:reference,species:z.string().max(200)}).strict(),knowledge:z.array(claim).max(100),relationships:z.array(relationship).max(100).default([]),playerSheet:playerSheetSchema.optional()}).strict(),
 house:z.object({background:z.string().max(12000),culture:z.string().max(4000),goals:strings}).strict(),
 location:z.object({geography:z.object({kind:z.enum(['continent','region','city','castle','district','building','room','site','wilderness','other']),parentId:reference}).strict(),politics:politicsSchema,culture:z.string().max(4000),wealth:z.string().max(1000),defenses:z.string().max(4000),lore:z.string().max(12000),loreFacts:z.array(loreFactSchema).max(100).optional()}).strict(),
 resource:resourceDataSchema,
 event:z.object({body:z.string().max(12000),actorIds:z.array(id),knownBy:z.array(id),assertions:z.array(assertion).max(50),worldTime:z.string().max(100)}).strict()
};
const header=z.object({schemaVersion:z.union([z.literal(1),z.literal(2)]),id,type:z.enum(['character','house','location','resource','event','campaign','chapter','faction','asset','culture']),name:z.string().trim().min(1).max(200),revision:z.number().int().positive(),visibility:z.enum(['public','secret']),gmContextMode:contextModeSchema.optional()}).strict();
const sections={aliases:'Aliases',cultures:'Cultures',cultureDeviations:'Culture Deviations',source:'Source',scope:'Scope',inherits:'Inheritance',related:'Related Records',norms:'Norms',cues:'Contextual Cues',variants:'Variants',traits:'Traits',appraisalPolicy:'Appraisal Policy',toolPolicy:'GM Tools',playerSheet:'Player Sheet',playerId:'Player',activePovId:'Active POV',sceneLocationId:'Scene',settings:'Settings',preferences:'Preferences',plans:'Declared Plans',number:'Number',level:'Level',sourceEventIds:'Source Events',sourceHashes:'Source Hashes',knownBy:'Known By',status:'Status',houseId:'Faction House',intentions:'Intentions',projects:'Projects',kind:'Kind',subjectIds:'Subjects',dataUrl:'Local Media',providerStatus:'Provider Status',background:'Background',appearance:'Appearance',current:'Current',goals:'Goals',house:'House',identity:'Identity',knowledge:'Knowledge',relationships:'Relationships',culture:'Culture',geography:'Geography',politics:'Politics',wealth:'Wealth',defenses:'Defenses',lore:'Lore',loreFacts:'Lore Facts',description:'Description',amount:'Amount',unit:'Unit',locationId:'Location',ownerHouseId:'Owner',controllerHouseId:'Controller',accessHouseIds:'Access',accessRights:'Access Rights',body:'Account',actorIds:'Actors',knownBy:'Known By',assertions:'Assertions',worldTime:'World Time'};
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export class StoreError extends Error{constructor(code,message){super(message);this.code=code;}}
const fail=(code,message)=>{throw new StoreError(code,message);};
export function validateRecord(record){
 z.object({...header.shape,data:z.unknown()}).strict().parse(record);
 const meta=header.parse(Object.fromEntries(Object.keys(header.shape).filter(key=>record[key]!==undefined).map(key=>[key,record[key]])));
 const parsed={...meta,data:dataSchemas[meta.type].parse(record.data)};for(const source of cultureSources(parsed))if(source.document==='records/'+parsed.id+'.md'&&source.revision!==String(parsed.revision))fail('SOURCE_STALE','Self-record culture provenance must match its canonical revision.');const problems=domainVersionProblems(parsed);if(problems.length)fail('SCHEMA_INVALID',problems.join('; '));return parsed;
}
function references(record){
 const d=record.data,refs=cultureReferences(record),add=(target,type)=>{if(target)refs.push([target,type]);};
 if(record.type==='character'){
  add(d.current.locationId,'location');add(d.current.allegianceHouseId,'house');Object.values(d.house).forEach(v=>add(v,'house'));d.identity.parentIds.forEach(v=>add(v,'character'));add(d.identity.originId,'location');
  for(const c of d.knowledge){c.knownBy.forEach(v=>add(v,'character'));c.evidenceIds.forEach(v=>add(v,'event'));for(const p of c.acquisitions||[]){add(p.actorId,'character');add(p.fromActorId,'character');p.evidenceIds.forEach(v=>add(v,'event'));}for(const p of c.beliefProvenance||[]){add(p.actorId,'character');add(p.sourceActorId,'character');p.basisEvidenceIds.forEach(v=>add(v,'event'));}}
  for(const r of d.relationships){add(r.targetId,'character');r.knownBy.forEach(v=>add(v,'character'));r.evidenceIds.forEach(v=>add(v,'event'));for(const effect of r.appraisalState?.effects||[])add(effect.eventId,'event');}
 }
 if(record.type==='location'){add(d.geography.parentId,'location');add(d.politics.rulingHouseId,'house');add(d.politics.controllerHouseId,'house');for(const c of d.politics.claims){add(typeof c==='string'?c:c.houseId,'house');if(typeof c!=='string'){c.evidenceIds.forEach(v=>add(v,'event'));c.knownBy.forEach(v=>add(v,'character'));}}for(const c of d.politics.controlHistory||[]){add(c.controllerHouseId,'house');add(c.recognizedRulerHouseId,'house');c.evidenceIds.forEach(v=>add(v,'event'));c.knownBy.forEach(v=>add(v,'character'));}}
 if(record.type==='resource'){add(d.locationId,'location');add(d.ownerHouseId,'house');add(d.controllerHouseId,'house');d.accessHouseIds.forEach(v=>add(v,'house'));for(const right of d.accessRights||[]){add(right.houseId,'house');right.evidenceIds.forEach(v=>add(v,'event'));right.knownBy.forEach(v=>add(v,'character'));}}
 if(record.type==='event'){d.actorIds.forEach(v=>add(v,'character'));d.knownBy.forEach(v=>add(v,'character'));d.assertions.forEach(v=>add(v.subjectId,null));}
 if(record.type==='campaign'){add(d.playerId,'character');add(d.activePovId,'character');add(d.sceneLocationId,'location');for(const plan of d.plans){add(plan.actorId,'character');plan.evidenceIds.forEach(v=>add(v,'event'));}}
 if(record.type==='character')for(const item of d.playerSheet?.inventory||[])add(item.resourceId,'resource');
 if(record.type==='chapter'){d.sourceEventIds.forEach(v=>add(v,'event'));d.knownBy.forEach(v=>add(v,'character'));}
 if(record.type==='faction'){add(d.houseId,'house');for(const intent of d.intentions){add(intent.actorId,'character');intent.sourceEventIds.forEach(v=>add(v,'event'));intent.knownBy.forEach(v=>add(v,'character'));}for(const project of d.projects){project.participants.forEach(v=>add(v,'character'));add(project.resourceId,'resource');project.sourceEventIds.forEach(v=>add(v,'event'));project.knownBy.forEach(v=>add(v,'character'));}}
 if(record.type==='asset'){d.sourceEventIds.forEach(v=>add(v,'event'));d.subjectIds.forEach(v=>add(v,null));d.knownBy.forEach(v=>add(v,'character'));}
 return refs;
}
export function renderMarkdown(record,names=new Map()){
 const meta=Object.fromEntries(Object.keys(header.shape).filter(key=>record[key]!==undefined).map(key=>[key,record[key]]));
 const lines=['---',...Object.entries(meta).map(([key,value])=>key+': '+JSON.stringify(value)),'---','','# '+record.name,''];
 for(const [key,value]of Object.entries(record.data))if(value!==undefined)lines.push('## '+sections[key],'',typeof value==='string'?'\x60\x60\x60text':'\x60\x60\x60json',typeof value==='string'?value:JSON.stringify(value,null,2),'\x60\x60\x60','');
 const refs=[...new Set(references(record).map(([target])=>target))];
 if(refs.length)lines.push('## Links','',...refs.map(target=>'- ['+(names.get(target)||target).replace(/[\[\]\\]/g,'')+']('+target+'.md)'),'');
 return lines.join('\n');
}
export function parseMarkdown(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024)fail('TOO_LARGE','Markdown exceeds 1 MiB.');
 const normalized=text.replace(/\r\n/g,'\n'),match=normalized.match(/^---\n([\s\S]*?)\n---\n/);
 if(!match)fail('INVALID_MARKDOWN','Expected schema frontmatter.');
 const meta={};for(const line of match[1].split('\n')){const entry=line.match(/^(\w+): (.+)$/);if(!entry||Object.hasOwn(meta,entry[1]))fail('INVALID_MARKDOWN','Invalid or duplicate frontmatter key.');meta[entry[1]]=JSON.parse(entry[2]);}
 header.parse(meta);const data={};
 for(const [key,title]of Object.entries(sections)){
  const matches=[...normalized.matchAll(new RegExp('^## '+title+'\\n\\n\x60\x60\x60(json|text)\\n([\\s\\S]*?)\\n\x60\x60\x60(?=\\n|$)','gm'))];
  if(matches.length>1)fail('INVALID_MARKDOWN','Duplicate section.');if(matches.length)data[key]=matches[0][1]==='text'?matches[0][2]:JSON.parse(matches[0][2]);
 }
 return validateRecord({...meta,data});
}
const inside=(root,target)=>{const relative=path.relative(root,target);return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
const locks=new Map(),writerScope=new AsyncLocalStorage();
export class MarkdownStore{
 constructor(root,{allowedRoot,fault}={}){this.root=path.resolve(root);this.allowedRoot=path.resolve(allowedRoot||root);this.fault=fault;}
 async init(){
  if(!inside(this.allowedRoot,this.root))fail('SCOPE_DENIED','Story root outside allowed workspace.');
  const ancestors=[];let ancestor=this.root;while(inside(this.allowedRoot,ancestor)){ancestors.push(ancestor);if(ancestor===this.allowedRoot)break;ancestor=path.dirname(ancestor);}
  for(const item of ancestors.reverse())try{if((await fs.lstat(item)).isSymbolicLink())fail('PATH_DENIED','Linked story ancestor.');}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.mkdir(this.root,{recursive:true});const allowed=await fs.realpath(this.allowedRoot);this.realRoot=await fs.realpath(this.root);
  if(!inside(allowed,this.realRoot)||(await fs.lstat(this.root)).isSymbolicLink())fail('PATH_DENIED','Linked or escaped story root.');
  for(const dir of ['records','.journal','.journal/receipts','.journal/runs','.journal/conflicts','.journal/pending']){await fs.mkdir(path.join(this.root,dir),{recursive:true});await this.checkInternal(dir);}
  await this.serial(async()=>{});return this;
 }
 async checkInternal(relative){
  if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'||part.includes(':')))fail('PATH_DENIED','Invalid internal path.');
  let current=this.root;for(const part of relative.split('/')){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())fail('PATH_DENIED','Linked sandbox path.');}
  if(await fs.realpath(this.root)!==this.realRoot||!inside(this.realRoot,await fs.realpath(current)))fail('PATH_DENIED','Sandbox path escaped.');return current;
 }
 async resolveSource(relative){
  if(typeof relative!=='string'||!/^records\/[a-z][a-z0-9_-]{0,79}\.md$/.test(relative))fail('PATH_DENIED','Use a record path inside this story.');
  await this.checkInternal('records');const target=path.join(this.root,...relative.split('/'));
  try{if((await fs.lstat(target)).isSymbolicLink()||!inside(this.realRoot,await fs.realpath(target)))fail('PATH_DENIED','Linked record is denied.');}catch(e){if(e.code!=='ENOENT')throw e;}return target;
 }
 onCanonicalCommit(listener){this.canonListeners||=new Set();this.canonListeners.add(listener);return ()=>this.canonListeners.delete(listener);}
 async serial(work){
  const previous=locks.get(this.root)||Promise.resolve();let release;const next=new Promise(resolve=>release=resolve);locks.set(this.root,next);await previous;let acquired=false;
  try{
   await this.checkInternal('.journal');const lock=path.join(this.root,'.journal/writer.lock');
   for(let i=0;i<100;i++)try{const file=await fs.open(lock,'wx');await file.writeFile(JSON.stringify({pid:process.pid}));await file.close();acquired=true;break;}
   catch(error){
    if(error.code!=='EEXIST')throw error;let content;try{await this.checkInternal('.journal/writer.lock');content=await fs.readFile(lock,'utf8');}catch(race){if(race.code==='ENOENT')continue;throw race;}
    try{const owner=JSON.parse(content);if(!Number.isSafeInteger(owner.pid)||owner.pid<1)fail('LOCK_INVALID','Invalid writer lock.');try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH'){await fs.unlink(lock);continue;}throw e;}}catch(e){if(e instanceof SyntaxError)fail('LOCK_INVALID','Writer lock needs recovery.');throw e;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   if(!acquired)fail('BUSY','Story has another writer.');return await writerScope.run(this.root,async()=>{await this.recover();return work();});
  }finally{if(acquired)await fs.unlink(path.join(this.root,'.journal/writer.lock'));release();if(locks.get(this.root)===next)locks.delete(this.root);if(this.canonDirty){this.canonDirty=false;await Promise.allSettled([...(this.canonListeners||[])].map(listener=>Promise.resolve().then(listener)));}}
 }
 async atomic(relative,content){
  const directory=path.dirname(relative).replaceAll('\\','/');await this.checkInternal(directory);const target=path.join(this.root,relative);
  try{if((await fs.lstat(target)).isSymbolicLink())fail('PATH_DENIED','Linked write target.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=path.join(path.dirname(target),'.tmp-'+randomUUID()),file=await fs.open(temporary,'wx');try{await file.writeFile(content);await file.sync();}finally{await file.close();}await this.checkInternal(directory);
  try{for(let attempt=0;;attempt++){try{await this.renameFault?.({relative,attempt});await fs.rename(temporary,target);if(relative.startsWith('.journal/receipts/'))this.canonDirty=true;break;}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=7)throw error;await new Promise(resolve=>setTimeout(resolve,10*(attempt+1)));await this.checkInternal(directory);}}}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
 }
 async recover(){
  await this.checkInternal('.journal/pending');
  for(const name of await fs.readdir(path.join(this.root,'.journal/pending'))){
   if(!/^[a-z][a-z0-9_-]{0,79}\.json$/.test(name))fail('JOURNAL_INVALID','Unknown pending journal entry.');
   const pending=JSON.parse(await this.journalRead('pending',name.slice(0,-5))),r=pending.receipt;id.parse(r?.operationId);id.parse(r?.recordId);
   if(pending.bundle){if(['commit-bundle','undo-commit-bundle'].includes(r.kind))await this.recoverCommit(pending,name);else await this.recoverBundle(pending,name);continue;}
   if(name!==r.operationId+'.json'||pending.path!=='records/'+r.recordId+'.md'||r.status!=='applied'||r.before!==pending.before||r.after!==pending.after||(pending.after===null?null:hash(pending.after))!==r.afterHash||(pending.before===null?null:hash(pending.before))!==r.beforeHash)fail('JOURNAL_INVALID','Invalid publication journal.');
   if((pending.after!==null&&parseMarkdown(pending.after).id!==r.recordId)||(pending.before!==null&&parseMarkdown(pending.before).id!==r.recordId))fail('JOURNAL_INVALID','Journal record mismatch.');
   const target=await this.resolveSource(pending.path),current=await fs.readFile(target,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
   if(current===pending.before){if(pending.after===null)await fs.unlink(target);else await this.atomic(pending.path,pending.after);}
   else if(current!==pending.after)fail('RECOVERY_CONFLICT','Record changed during interrupted publication; preserve both versions.');
   await this.atomic('.journal/receipts/'+r.operationId+'.json',JSON.stringify(r,null,2));await fs.unlink(path.join(this.root,'.journal/pending',name));
  }
 }
 async readGate(){if(writerScope.getStore()===this.root)return;await this.checkInternal('.journal/pending');for(const name of await fs.readdir(path.join(this.root,'.journal/pending'))){if(!name.endsWith('.json'))continue;let content;try{await this.checkInternal('.journal/pending/'+name);content=await fs.readFile(path.join(this.root,'.journal/pending',name),'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}const pending=JSON.parse(content);if(['create-bundle','rollback-create-bundle','commit-bundle','undo-commit-bundle'].includes(pending.receipt?.kind))fail('RECOVERY_PENDING','A canonical creation batch is publishing or needs recovery.');}}
 async raw(recordId){await this.readGate();id.parse(recordId);const file=await this.resolveSource('records/'+recordId+'.md');if((await fs.stat(file)).size>1024*1024)fail('TOO_LARGE','Markdown exceeds 1 MiB.');const text=await fs.readFile(file,'utf8'),record=parseMarkdown(text);if(record.id!==recordId)fail('ID_MISMATCH','Filename and stable ID disagree.');return {record,text,hash:hash(text)};}
 async all(){
  await this.readGate();await this.checkInternal('records');const names=await fs.readdir(path.join(this.root,'records')),rows=[];if(names.length>500)fail('BUDGET_EXCEEDED','Fixture story exceeds the 500-file sandbox budget.');let bytes=0;
  for(const name of names.sort()){if(!/^[a-z][a-z0-9_-]{0,79}\.md$/.test(name)){if(name.startsWith('.tmp-'))continue;fail('PATH_DENIED','Unexpected record filename.');}const row=await this.raw(name.slice(0,-3));bytes+=Buffer.byteLength(row.text);if(bytes>8*1024*1024)fail('BUDGET_EXCEEDED','Fixture story exceeds the 8 MiB read budget.');rows.push(row);}return rows;
 }
 visible(record,authority){
  if(!authority||!['gm','assistant','player','npc'].includes(authority.role))fail('SCOPE_DENIED','Invalid tool role.');
  if(authority.role==='npc'){id.parse(authority.actorId);return record.type==='culture'&&record.data.knownBy.includes(authority.actorId)&&cultureAccess(record.data.source,authority)||record.id===authority.actorId||(record.type==='event'&&record.data.knownBy.includes(authority.actorId));}
  return ['gm','assistant'].includes(authority.role)||record.visibility==='public';
 }
 view(record,authority){
  if(!this.visible(record,authority))fail('KNOWLEDGE_DENIED','Record not available to this actor.');const result=structuredClone(record);if(!['gm','assistant'].includes(authority.role))delete result.gmContextMode;
  if(record.type==='culture'){result.data=filterCultureData(record.data,authority);if(!['gm','assistant'].includes(authority.role))result.data.inherits=[];}if(record.type==='character'&&!['gm','assistant'].includes(authority.role)){if(result.data.aliases)result.data.aliases=result.data.aliases.filter(row=>cultureAccess(row,authority)).map(row=>({...row,visibility:['character:'+authority.actorId],knownBy:[authority.actorId]}));if(result.data.cultures)result.data.cultures=result.data.cultures.filter(row=>cultureAccess(row,authority)).map(row=>({...row,visibility:['character:'+authority.actorId],knownBy:[authority.actorId]}));if(result.data.cultureDeviations)result.data.cultureDeviations=result.data.cultureDeviations.filter(row=>cultureAccess(row,authority)).map(row=>({...row,visibility:['character:'+authority.actorId],knownBy:[authority.actorId]}));
   if(authority.role==='player'&&authority.actorId!==record.id)delete result.data.playerSheet;
   result.data.knowledge=result.data.knowledge.filter(c=>authority.role==='npc'?c.knownBy.includes(authority.actorId):c.visibility==='public').map(c=>({...c,...(authority.role==='npc'?{knownBy:[authority.actorId]}:{}),...(c.acquisitions?{acquisitions:c.acquisitions.filter(p=>authority.role==='npc'?p.actorId===authority.actorId:p.visibility==='public')}:{}),...(c.beliefProvenance?{beliefProvenance:c.beliefProvenance.filter(p=>authority.role==='npc'?p.actorId===authority.actorId:p.visibility==='public')}: {})}));
   result.data.relationships=result.data.relationships.filter(c=>authority.role==='npc'?c.knownBy.includes(authority.actorId):c.visibility==='public').map(c=>{if(authority.role!=='npc'||authority.actorId!==record.id)delete c.appraisalState;return c;});
   for(const field of ['aliases','cultures','cultureDeviations'])if(result.data[field]?.length===0)delete result.data[field];
   result.data.identity={parentIds:[],originId:null,species:record.data.identity.species};result.data.background='';result.data.house.birthId=null;if(authority.role==='player')result.data.goals=[];
  }
  if(authority.role==='npc'&&record.type==='event')result.data.assertions=[];
  if(authority.role==='player'&&record.type==='location'){result.data.politics.claims=result.data.politics.claims.filter(c=>typeof c==='string'||c.visibility==='public');if(result.data.politics.controlHistory)result.data.politics.controlHistory=result.data.politics.controlHistory.filter(c=>c.visibility==='public');}
  if(authority.role==='player'&&record.type==='resource'&&result.data.accessRights)result.data.accessRights=result.data.accessRights.filter(c=>c.visibility==='public');return result;
 }
 async list(authority){return(await this.all()).filter(row=>this.visible(row.record,authority)).map(row=>({...this.view(row.record,authority),hash:row.hash,path:'records/'+row.record.id+'.md'}));}
 async read(recordId,authority){const row=await this.raw(recordId),record=this.view(row.record,authority),canonical=['gm','assistant'].includes(authority.role);return {record,hash:row.hash,markdown:canonical?row.text:renderMarkdown(record),view:canonical?'source':'actor-view',path:'records/'+recordId+'.md'};}
 async search(query,authority,{limit=30}={}){
  if(typeof query!=='string'||!query.trim()||query.length>300)fail('QUERY_INVALID','Use a literal query of 1-300 characters.');z.number().int().min(1).max(100).parse(limit);const matches=[];
  for(const raw of await this.all()){
   if(!this.visible(raw.record,authority))continue;const row=this.view(raw.record,authority),canonical=['gm','assistant'].includes(authority.role),lines=(canonical?raw.text:renderMarkdown(row)).split('\n');
   for(let i=0;i<lines.length&&matches.length<limit;i++)if(lines[i].toLowerCase().includes(query.toLowerCase()))matches.push({id:row.id,name:row.name,path:'records/'+row.id+'.md',line:i+1,lineKind:canonical?'source':'actor-view',text:lines[i].slice(0,500),hash:raw.hash});if(matches.length>=limit)break;
  }return {matches,truncated:matches.length===limit};
 }
 async validateReferences(candidate,rows){
  const map=new Map(rows.map(row=>[row.record.id,row.record]));map.set(candidate.id,candidate);
  if(candidate.type==='character')for(const claim of [...candidate.data.knowledge,...candidate.data.relationships]){if(claim.kind&&claim.kind!=='belief'&&claim.knownBy.length&&!claim.evidenceIds.length&&claim.knownBy.some(actor=>!claim.acquisitions?.some(p=>p.actorId===actor&&p.evidenceIds.length)))fail('EVIDENCE_REQUIRED','Learned knowledge needs actor-visible evidence.');for(const evidenceId of claim.evidenceIds){const source=map.get(evidenceId);if(source?.type!=='event'||claim.knownBy.some(actor=>!source.data.knownBy.includes(actor)))fail('KNOWLEDGE_DENIED','Knowledge/relationship evidence is not known to its stated actors.');}}


  if(candidate.type==='character')for(const relationship of candidate.data.relationships){const state=relationship.appraisalState;if(!state)continue;if(state.actorId!==candidate.id||new Set(state.effects.map(e=>e.effectId)).size!==state.effects.length)fail('APPRAISAL_INVALID','Affinity effects belong to this actor and apply once.');for(const effect of state.effects){const source=map.get(effect.eventId);if(source?.type!=='event'||!source.data.knownBy.includes(candidate.id))fail('KNOWLEDGE_DENIED','An affinity effect requires personally witnessed accepted evidence.');}}
  if(candidate.type==='character')for(const claim of candidate.data.knowledge){
   for(const p of [...claim.acquisitions||[],...claim.beliefProvenance||[]]){const sources=p.evidenceIds||p.basisEvidenceIds;if(claim.kind!=='belief'&&claim.knownBy.includes(p.actorId)&&!sources.length)fail('EVIDENCE_REQUIRED','Knowledge acquisition requires personally visible evidence.');for(const sourceId of sources){const source=map.get(sourceId);if(source?.type!=='event'||!source.data.knownBy.includes(p.actorId))fail('KNOWLEDGE_DENIED','Acquisition/belief evidence is unknown to its actor.');}}
  }
  const political=candidate.type==='location'?[...candidate.data.politics.claims.filter(c=>typeof c!=='string'),...candidate.data.politics.controlHistory||[]]:candidate.type==='resource'?candidate.data.accessRights||[]:[];
  for(const claim of political)for(const sourceId of claim.evidenceIds){const source=map.get(sourceId);if(source?.type!=='event'||claim.knownBy.some(actor=>!source.data.knownBy.includes(actor)))fail('KNOWLEDGE_DENIED','Political/access evidence is unknown to its stated actors.');}

  for(const [target,type]of references(candidate))if(!map.has(target)||(type&&map.get(target).type!==type))fail('REFERENCE_INVALID','Missing or incorrect reference: '+target);
  validateCultureGraph(map);if(candidate.type==='character'){const visited=new Set(),walk=(subject,visiting)=>{if(visiting.has(subject))fail('PARENTAGE_CYCLE','Parentage cannot contain a cycle.');if(visited.has(subject))return;const next=new Set(visiting);next.add(subject);for(const parent of map.get(subject)?.data.identity?.parentIds||[])walk(parent,next);visited.add(subject);};walk(candidate.id,new Set());}
  if(candidate.type==='location'){const visited=new Set([candidate.id]);let parent=candidate.data.geography.parentId;while(parent){if(visited.has(parent))fail('CONTAINMENT_CYCLE','Containment would create a cycle.');visited.add(parent);parent=map.get(parent).data.geography.parentId;}}
 }
 async journalRead(directory,recordId){id.parse(recordId);if(!['pending','receipts','runs','conflicts'].includes(directory))fail('PATH_DENIED','Unknown journal directory.');const relative='.journal/'+directory+'/'+recordId+'.json';try{await this.checkInternal(relative);return await fs.readFile(path.join(this.root,relative),'utf8');}catch(e){if(e.code==='ENOENT')return 'null';throw e;}}
 async receipt(operationId){return JSON.parse(await this.journalRead('receipts',operationId));}
 async publish(before,record,operationId,fingerprint,details={}){syncCultureSourceRevision(record);
  await runFenceFor(this.root)?.check();
  const rows=await this.all();await this.validateReferences(record,rows);const names=new Map(rows.map(row=>[row.record.id,row.record.name]));names.set(record.id,record.name);const after=renderMarkdown(record,names);
  if(hash(parseMarkdown(after))!==hash(validateRecord(record)))fail('INVALID_MARKDOWN','Field content cannot roundtrip safely in Markdown.');
  const receipt={operationId,fingerprint,status:'applied',recordId:record.id,revision:record.revision,beforeHash:before===null?null:hash(before),afterHash:hash(after),before,after,...details,at:new Date().toISOString()};
  const pending={path:'records/'+record.id+'.md',before,after,receipt};await this.atomic('.journal/pending/'+operationId+'.json',JSON.stringify(pending,null,2));await this.fault?.('after-journal',pending);await this.atomic(pending.path,after);await this.fault?.('after-record',pending);await this.atomic('.journal/receipts/'+operationId+'.json',JSON.stringify(receipt,null,2));await fs.unlink(path.join(this.root,'.journal/pending',operationId+'.json'));return receipt;
 }
 async seed(records){
  return this.serial(async()=>{
   if((await this.all()).length)return false;const parsed=records.map(validateRecord),rows=parsed.map(record=>({record}));if(new Set(parsed.map(record=>record.id)).size!==parsed.length)fail('ID_CONFLICT','Duplicate stable IDs in fixture import.');for(const record of parsed)await this.validateReferences(record,rows);
   const names=new Map(parsed.map(record=>[record.id,record.name])),documents=parsed.map(record=>[record.id,renderMarkdown(record,names)]);
   for(let i=0;i<documents.length;i++)if(hash(parseMarkdown(documents[i][1]))!==hash(parsed[i]))fail('INVALID_MARKDOWN','Import does not roundtrip.');
   for(const [recordId,text]of documents)await this.atomic('records/'+recordId+'.md',text);return true;
  });
 }
 async create(input,authority){
  const request=z.object({operationId:id,record:z.unknown()}).strict().parse(input);if(authority?.role!=='assistant')fail('WRITE_DENIED','Only the author establishes new accepted records.');
  const record=validateRecord(request.record);if(record.revision!==1)fail('VERSION_CONFLICT','New records start at revision one.');const fingerprint=hash({request,role:authority.role});
  return this.serial(async()=>{const prior=await this.receipt(request.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Creation ID reused.');return {...prior,replayed:true};}if((await this.all()).some(row=>row.record.id===record.id))fail('ID_CONFLICT','Stable ID already exists.');return this.publish(null,record,request.operationId,fingerprint,{role:'assistant',kind:'create'});});
 }
 async validateBundle(documents,{existing=[]}={}){
  if(!Array.isArray(documents)||!documents.length||documents.length>500||documents.some(text=>typeof text!=='string')||documents.reduce((n,text)=>n+Buffer.byteLength(text),0)>8*1024*1024)fail('BUDGET_EXCEEDED','Use 1-500 documents within 8 MiB.');
  const records=documents.map(parseMarkdown),rows=[...existing,...records.map(record=>({record}))];if(new Set(records.map(r=>r.id)).size!==records.length)fail('ID_CONFLICT','Duplicate bundle IDs.');for(const record of records)await this.validateReferences(record,rows);
  const names=new Map(rows.map(r=>[r.record.id,r.record.name]));return records.map(record=>{const after=renderMarkdown(record,names);if(hash(parseMarkdown(after))!==hash(record))fail('INVALID_MARKDOWN','Bundle cannot roundtrip.');return {path:'records/'+record.id+'.md',after};});
 }
 async recoverBundle(pending,name){
  const r=pending.receipt;if(name!==r.operationId+'.json'||!['import','rollback-import','create-bundle','rollback-create-bundle'].includes(r.kind)||r.status!=='applied'||hash(pending.bundle)!==r.bundleHash)fail('JOURNAL_INVALID','Invalid migration journal.');
  const removing=['rollback-import','rollback-create-bundle'].includes(r.kind),canonical=await this.validateBundle(pending.bundle.map(row=>removing?row.before:row.after),{existing:['create-bundle','rollback-create-bundle'].includes(r.kind)?(await this.all()).filter(row=>!r.recordIds.includes(row.record.id)):[]});
  const expected=removing?canonical.map(row=>({path:row.path,before:row.after,after:null})):canonical;
  if(hash(expected)!==hash(pending.bundle)||r.recordId!==parseMarkdown(canonical[0].after).id||hash(r.recordIds)!==hash(canonical.map(row=>parseMarkdown(row.after).id)))fail('JOURNAL_INVALID','Migration paths or records disagree.');
  const states=[];for(const row of expected){const target=await this.resolveSource(row.path),current=await fs.readFile(target,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(current!==null&&current!==(removing?row.before:row.after))fail('RECOVERY_CONFLICT','Migration target changed; preserve both versions.');states.push(current);}
  for(let i=0;i<expected.length;i++){const row=expected[i];if(removing&&states[i]!==null)await fs.unlink(await this.resolveSource(row.path));else if(!removing&&states[i]===null)await this.atomic(row.path,row.after);await this.fault?.('after-import-record',{index:i,removing});}
  await this.atomic('.journal/receipts/'+r.operationId+'.json',JSON.stringify(r,null,2));await fs.unlink(path.join(this.root,'.journal/pending',name));
 }
 async createBatch(input,authority){
  const request=z.object({operationId:id,records:z.array(z.unknown()).min(1).max(21)}).strict().parse(input);if(authority?.role!=='assistant')fail('WRITE_DENIED','Only the accepted runtime/author establishes a batch.');const fingerprint=hash(request);
  return this.serial(async()=>{const prior=await this.receipt(request.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Creation batch ID reused.');return {...prior,replayed:true};}const existing=await this.all(),records=request.records.map(validateRecord);if(records.some(record=>record.revision!==1||existing.some(row=>row.record.id===record.id)))fail('ID_CONFLICT','Creation must use new stable IDs and revision one.');
   if(existing.length+records.length>500)fail('BUDGET_EXCEEDED','Creation exceeds campaign record budget.');await runFenceFor(this.root)?.check();const bundle=await this.validateBundle(records.map(record=>renderMarkdown(record)),{existing});if(existing.reduce((sum,row)=>sum+Buffer.byteLength(row.text),0)+bundle.reduce((sum,row)=>sum+Buffer.byteLength(row.after),0)>8*1024*1024)fail('BUDGET_EXCEEDED','Creation exceeds campaign byte budget.');const receipt={operationId:request.operationId,fingerprint,recordId:records[0].id,recordIds:records.map(record=>record.id),kind:'create-bundle',status:'applied',bundleHash:hash(bundle),bundle,at:new Date().toISOString()},pending={bundle,receipt};
   await this.atomic('.journal/pending/'+request.operationId+'.json',JSON.stringify(pending,null,2));await this.fault?.('after-import-journal',pending);await this.recoverBundle(pending,request.operationId+'.json');return receipt;
  });
 }
 async importBundle(input,authority){
  const request=z.object({operationId:id,documents:z.array(z.string()).max(500)}).strict().parse(input);if(authority?.role!=='assistant')fail('WRITE_DENIED','Migration requires the author.');const bundle=await this.validateBundle(request.documents),fingerprint=hash(request);
  return this.serial(async()=>{const prior=await this.receipt(request.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Import ID reused.');return {...prior,replayed:true};}if((await this.all()).length)fail('IMPORT_TARGET_NOT_EMPTY','Import only into an empty isolated story.');
   const receipt={operationId:request.operationId,fingerprint,recordId:parseMarkdown(bundle[0].after).id,kind:'import',status:'applied',recordIds:bundle.map(row=>parseMarkdown(row.after).id),bundleHash:hash(bundle),bundle,at:new Date().toISOString()},pending={bundle,receipt};
   await this.atomic('.journal/pending/'+request.operationId+'.json',JSON.stringify(pending,null,2));await this.fault?.('after-import-journal',pending);await this.recoverBundle(pending,request.operationId+'.json');return receipt;
  });
 }
 async rollbackImport(input,authority){
  const request=z.object({operationId:id,importOperationId:id}).strict().parse(input);if(authority?.role!=='assistant')fail('WRITE_DENIED','Rollback requires the author.');const fingerprint=hash(request);
  return this.serial(async()=>{const prior=await this.receipt(request.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Rollback ID reused.');return {...prior,replayed:true};}
   const imported=await this.receipt(request.importOperationId);if(!['import','create-bundle'].includes(imported?.kind))fail('UNDO_UNAVAILABLE','Not a migration receipt.');
   const rows=await this.all(),ids=new Set(imported.recordIds);for(const entry of imported.bundle){const row=rows.find(row=>'records/'+row.record.id+'.md'===entry.path);if(!row||row.text!==entry.after)fail('VERSION_CONFLICT','Imported record has changed.');}
   if(rows.some(row=>!ids.has(row.record.id)&&references(row.record).some(([target])=>ids.has(target))))fail('REFERENCE_INVALID','New records refer to imported records; preserve them.');
   if((await this.history()).some(receipt=>!ids.has(receipt.recordId)&&receipt.status==='applied'&&receipt.evidenceIds?.some(sourceId=>ids.has(sourceId))))fail('REFERENCE_INVALID','Accepted outside effects still use the creation source; undo those effects first.');
   const bundle=imported.bundle.map(row=>({path:row.path,before:row.after,after:null})),receipt={operationId:request.operationId,fingerprint,recordId:imported.recordId,recordIds:imported.recordIds,kind:imported.kind==='create-bundle'?'rollback-create-bundle':'rollback-import',status:'applied',undoOf:request.importOperationId,bundleHash:hash(bundle),at:new Date().toISOString()},pending={bundle,receipt};
   await this.atomic('.journal/pending/'+request.operationId+'.json',JSON.stringify(pending,null,2));await this.fault?.('after-import-journal',pending);await this.recoverBundle(pending,request.operationId+'.json');return receipt;
  });
 }
 async upgradeSyntheticSchema(input,authority){
  if(authority?.role!=='assistant'||authority.qualificationFixture!==true)fail('MIGRATION_DENIED','Schema upgrades require an explicit synthetic fixture capability.');
  const request=z.object({id,operationId:id,expectedHash:z.string().regex(/^[a-f0-9]{64}$/),data:z.unknown()}).strict().parse(input),fingerprint=hash(request);
  return this.serial(async()=>{const prior=await this.receipt(request.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Schema upgrade ID reused.');return {...prior,replayed:true};}const before=await this.raw(request.id);if(before.hash!==request.expectedHash)fail('VERSION_CONFLICT','Reread before upgrading a synthetic record.');if(before.record.schemaVersion!==1||!['location','resource','character'].includes(before.record.type))fail('MIGRATION_DENIED','Only version-one synthetic domain records can upgrade.');const candidate=validateRecord({...before.record,schemaVersion:2,revision:before.record.revision+1,data:request.data});return this.publish(before.text,candidate,request.operationId,fingerprint,{role:'assistant',kind:'schema-upgrade',fromSchemaVersion:1,toSchemaVersion:2,fields:['schemaVersion','data'],evidenceIds:[]});});
 }
 async prepareEdit(input,authority,{rows,priorEffects}={}){
  const request=z.object({id,operationId:id,expectedHash:z.string().regex(/^[a-f0-9]{64}$/),patch:z.record(z.string(),z.unknown()),evidenceIds:z.array(id).default([])}).strict().parse(input);
  if(!['gm','assistant'].includes(authority?.role))fail('WRITE_DENIED','This role cannot edit accepted files.');const fingerprint=hash({request,role:authority.role});
  rows||=await this.all();priorEffects||=authority.role==='gm'?await this.history():[];
   const before=await this.raw(request.id);if(authority.role==='gm'&&before.record.type==='campaign')fail('WRITE_DENIED','Campaign settings/POV/player controls belong to the author.');if(before.hash!==request.expectedHash)fail('VERSION_CONFLICT','Markdown changed; reread before editing.');
   const candidate=structuredClone(before.record),evidence=rows.filter(row=>request.evidenceIds.includes(row.record.id)&&row.record.type==='event').map(row=>row.record);
   const skippedSourceEffects=[];const evidenceHashes=Object.fromEntries(rows.filter(row=>request.evidenceIds.includes(row.record.id)).map(row=>[row.record.id,row.hash]));
   if(!Object.keys(request.patch).length)fail('FIELD_DENIED','Choose at least one field.');if(request.evidenceIds.length!==evidence.length)fail('EVIDENCE_INVALID','Evidence must reference accepted event records.');
   for(const [field,value]of Object.entries(request.patch)){
    const parts=field.split('.');if(field==='name'||field==='gmContextMode'){if(authority.role!=='assistant')fail('EVIDENCE_REQUIRED','Names change through explicit author editing.');candidate[field]=value;continue;}
    if(!/^data\.[A-Za-z]+(?:\.[A-Za-z]+)?$/.test(field)||parts.some(p=>['__proto__','constructor','prototype'].includes(p)))fail('FIELD_DENIED','Use a typed data field, not whole-record replacement.');
    if(parts.length===2&&['identity','current','house','geography','politics'].includes(parts[1]))fail('FIELD_DENIED','Edit one nested field at a time.');
    let target=candidate;for(const part of parts.slice(0,-1)){if(!Object.hasOwn(target,part)||typeof target[part]!=='object'||target[part]===null)fail('FIELD_DENIED','Unknown data field.');target=target[part];}
    const key=parts.at(-1);if(!Object.hasOwn(target,key)&&!(parts.length===2&&Object.hasOwn(dataSchemas[candidate.type].shape,key)))fail('FIELD_DENIED','Unknown data field.');
    if(authority.role==='gm'&&!evidence.some(event=>event.data.assertions.some(a=>a.subjectId===request.id&&a.field===field&&hash(a.value)===hash(value))))fail('EVIDENCE_REQUIRED','No accepted source supports '+field+'.');
    if(authority.role==='gm'){
     const supporting=evidence.filter(event=>event.data.assertions.some(a=>a.subjectId===request.id&&a.field===field&&hash(a.value)===hash(value)));
     const alreadyApplied=supporting.length&&supporting.every(event=>priorEffects.some(receipt=>receipt.status==='applied'&&receipt.recordId===request.id&&receipt.fields?.includes(field)&&receipt.evidenceIds?.includes(event.id)&&(receipt.evidenceHashes?.[event.id]===evidenceHashes[event.id]||(!receipt.evidenceHashes&&event.revision===1))));
     if(alreadyApplied){skippedSourceEffects.push(field);continue;}
    }
    const fieldSchema=parts.length===3?dataSchemas[candidate.type].shape[parts[1]]?.shape?.[key]:dataSchemas[candidate.type].shape[key];if(!fieldSchema)fail('FIELD_DENIED','Unknown typed field.');fieldSchema.parse(value);const previous=target[key];
    const protectedFact=['data.identity.parentIds','data.identity.originId','data.identity.species','data.house.birthId'].includes(field);
    const contradiction=protectedFact&&previous!=null&&(Array.isArray(previous)?previous.some(v=>!value.includes(v)):previous!==''&&hash(previous)!==hash(value));
    const backgroundRetcon=field==='data.background'&&typeof value==='string'&&previous&&!value.includes(previous);
    if(authority.role==='gm'&&(contradiction||backgroundRetcon)){
     const result={operationId:request.operationId,fingerprint,status:'conflict',recordId:request.id,field,established:previous,proposed:value,evidenceIds:request.evidenceIds,evidenceHashes,skippedSourceEffects,at:new Date().toISOString()};
     return {request,fingerprint,receipt:result};
    }target[key]=structuredClone(value);
   }

   const details={role:authority.role,evidenceIds:request.evidenceIds,evidenceHashes,skippedSourceEffects,fields:Object.keys(request.patch).filter(field=>!skippedSourceEffects.includes(field))};
   if(hash(candidate)===hash(before.record))return {request,fingerprint,receipt:{operationId:request.operationId,fingerprint,status:'unchanged',recordId:request.id,revision:candidate.revision,beforeHash:before.hash,afterHash:before.hash,...details,at:new Date().toISOString()}};
   candidate.revision++;syncCultureSourceRevision(candidate);validateRecord(candidate);return {request,fingerprint,before,candidate,details};
 }
 async edit(input,authority){
  const request=z.object({id,operationId:id,expectedHash:z.string().regex(/^[a-f0-9]{64}$/),patch:z.record(z.string(),z.unknown()),evidenceIds:z.array(id).default([])}).strict().parse(input);
  if(!['gm','assistant'].includes(authority?.role))fail('WRITE_DENIED','This role cannot edit accepted files.');const fingerprint=hash({request,role:authority.role});
  return this.serial(async()=>{
   const prior=await this.receipt(request.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Operation ID already used for another edit.');return {...prior,replayed:true};}
   const prepared=await this.prepareEdit(request,authority);
   if(prepared.receipt){if(prepared.receipt.status==='conflict')await this.atomic('.journal/conflicts/'+request.operationId+'.json',JSON.stringify(prepared.receipt,null,2));await this.atomic('.journal/receipts/'+request.operationId+'.json',JSON.stringify(prepared.receipt,null,2));return prepared.receipt;}
   return this.publish(prepared.before.text,prepared.candidate,request.operationId,fingerprint,prepared.details);
  });
 }
 /** Author-approved coordination: all revisions validate before any publication.
  * GM edits retain evidence/protected-fact rules; creates require explicit approval. */
 async commitBatch(input,authority,{check}={}){
  const request=z.object({operationId:id,edits:z.array(z.object({id,expectedHash:z.string().regex(/^[a-f0-9]{64}$/),patch:z.record(z.string(),z.unknown()),evidenceIds:z.array(id).default([])}).strict()).max(20).default([]),creates:z.array(z.unknown()).max(20).default([]),provenance:z.object({agentId:id,sessionId:id,taskId:id,proposalHash:z.string().regex(/^[a-f0-9]{64}$/),approvalId:id}).strict()}).strict().parse(input);
  if(authority?.role!=='assistant')fail('WRITE_DENIED','A coordinated commit requires explicit author approval.');if(!request.edits.length&&!request.creates.length)fail('PROPOSAL_INVALID','Empty canonical proposal.');const fingerprint=hash(request);
  return this.serial(async()=>{
   const prior=await this.receipt(request.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Commit ID reused.');return {...prior,replayed:true};}
   await check?.();await runFenceFor(this.root)?.check();const {bundle,effects,affected}=await this.prepareBatch(request);
   const receipt={operationId:request.operationId,fingerprint,kind:'commit-bundle',status:bundle.length?'applied':'unchanged',recordId:affected[0],recordIds:affected,effects,provenance:request.provenance,bundleHash:hash(bundle),bundle,at:new Date().toISOString()};
   if(!bundle.length){await this.atomic('.journal/receipts/'+request.operationId+'.json',JSON.stringify(receipt,null,2));return receipt;}
   await check?.();await runFenceFor(this.root)?.check();const pending={bundle,receipt};await this.atomic('.journal/pending/'+request.operationId+'.json',JSON.stringify(pending,null,2));await this.fault?.('after-commit-journal',pending);await this.recoverCommit(pending,request.operationId+'.json');return receipt;
  });
 }
 async prepareBatch(request){
   const existing=await this.all(),creates=request.creates.map(validateRecord),affected=[...request.edits.map(e=>e.id),...creates.map(r=>r.id)];
   if(new Set(affected).size!==affected.length)fail('ID_CONFLICT','Only one proposed revision per stable ID.');if(creates.some(r=>r.revision!==1||existing.some(row=>row.record.id===r.id)))fail('ID_CONFLICT','New records require new IDs and revision one.');
   const rows=[...existing,...creates.map(record=>({record,text:renderMarkdown(record),hash:hash(renderMarkdown(record))}))],priorEffects=await this.history(),prepared=[];
   for(const edit of request.edits){const result=await this.prepareEdit({...edit,operationId:'effect_'+hash([request.operationId,edit.id]).slice(0,40)},{role:'gm'},{rows,priorEffects});if(result.receipt?.status==='conflict')fail('CANON_CONFLICT','Protected canon conflicts with this proposal; nothing was published.');prepared.push(result);}
   const finalRecords=[...existing.filter(row=>!request.edits.some(e=>e.id===row.record.id)).map(row=>row.record),...prepared.map(p=>p.candidate||existing.find(row=>row.record.id===p.request.id).record),...creates];
   if(finalRecords.length>500)fail('BUDGET_EXCEEDED','Campaign record budget exceeded.');const finalRows=finalRecords.map(record=>({record})),names=new Map(finalRecords.map(r=>[r.id,r.name]));for(const record of finalRecords)await this.validateReferences(record,finalRows);
   const documents=finalRecords.map(record=>renderMarkdown(record,names));if(documents.reduce((n,t)=>n+Buffer.byteLength(t),0)>8*1024*1024)fail('BUDGET_EXCEEDED','Campaign byte budget exceeded.');
   const bundle=[...prepared.filter(p=>p.candidate).map(p=>({path:'records/'+p.candidate.id+'.md',before:p.before.text,after:renderMarkdown(p.candidate,names)})),...creates.map(record=>({path:'records/'+record.id+'.md',before:null,after:renderMarkdown(record,names)}))];
   for(const row of bundle)if(hash(parseMarkdown(row.after))!==hash(finalRecords.find(r=>'records/'+r.id+'.md'===row.path)))fail('INVALID_MARKDOWN','Coordinated records cannot roundtrip.');
   const effects=prepared.map(p=>p.receipt||{operationId:p.request.operationId,status:'applied',recordId:p.candidate.id,revision:p.candidate.revision,beforeHash:p.before.hash,afterHash:hash(renderMarkdown(p.candidate,names)),...p.details});
  return {bundle,effects,affected};
 }
 async previewBatch(input,authority){if(authority?.role!=='assistant')fail('WRITE_DENIED','Preview is an author operation.');const request=z.object({edits:z.array(z.object({id,expectedHash:z.string().regex(/^[a-f0-9]{64}$/),patch:z.record(z.string(),z.unknown()),evidenceIds:z.array(id).default([])}).strict()).max(20).default([]),creates:z.array(z.unknown()).max(20).default([])}).strict().parse(input);if(!request.edits.length&&!request.creates.length)fail('PROPOSAL_INVALID','Empty proposal.');const preview=async()=>{const prepared=await this.prepareBatch({...request,operationId:'author_preview'});return {proposalHash:hash(request),changes:prepared.bundle.map(row=>({id:parseMarkdown(row.after).id,path:row.path,beforeHash:row.before===null?null:hash(row.before),afterHash:hash(row.after),before:row.before,after:row.after})),effects:prepared.effects,publication:'preview only'};};return writerScope.getStore()===this.root?preview():this.serial(preview);}
 async recoverCommit(pending,name){
  const r=pending.receipt;if(name!==r.operationId+'.json'||!['commit-bundle','undo-commit-bundle'].includes(r.kind)||r.status!=='applied'||hash(pending.bundle)!==r.bundleHash||!pending.bundle.length||pending.bundle.length>40)fail('JOURNAL_INVALID','Invalid coordinated journal.');
  const ids=[],states=[];for(const row of pending.bundle){const after=row.after===null?null:parseMarkdown(row.after),before=row.before===null?null:parseMarkdown(row.before),recordId=after?.id||before?.id;if(!recordId||row.after===null&&r.kind!=='undo-commit-bundle'||row.path!=='records/'+recordId+'.md'||before&&after&&(before.id!==after.id||after.revision!==before.revision+1)||!before&&after?.revision!==1)fail('JOURNAL_INVALID','Invalid coordinated revision/path.');ids.push(recordId);const target=await this.resolveSource(row.path),current=await fs.readFile(target,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(current!==row.before&&current!==row.after)fail('RECOVERY_CONFLICT','A coordinated target changed; preserve both versions.');states.push(current);}
  if(new Set(ids).size!==ids.length||ids.some(recordId=>!r.recordIds.includes(recordId)))fail('JOURNAL_INVALID','Coordinated stable IDs disagree.');
  const finalRows=[...(await this.all()).filter(row=>!ids.includes(row.record.id)),...pending.bundle.filter(row=>row.after!==null).map(row=>({record:parseMarkdown(row.after)}))];for(const row of finalRows)await this.validateReferences(row.record,finalRows);
  for(let i=0;i<pending.bundle.length;i++){const row=pending.bundle[i];if(states[i]!==row.after){if(row.after===null)await fs.unlink(await this.resolveSource(row.path));else await this.atomic(row.path,row.after);}await this.fault?.('after-commit-record',{index:i});}
  await this.atomic('.journal/receipts/'+r.operationId+'.json',JSON.stringify(r,null,2));await fs.unlink(path.join(this.root,'.journal/pending',name));
 }
 async undoBatch(input,authority,{check}={}){const request=z.object({operationId:id,commitId:id}).strict().parse(input);if(authority?.role!=='assistant')fail('WRITE_DENIED','Undo is an author operation.');const fingerprint=hash(request);return this.serial(async()=>{const replay=await this.receipt(request.operationId);if(replay){if(replay.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Undo ID changed.');return {...replay,replayed:true};}await check?.();const original=await this.receipt(request.commitId);if(original?.kind!=='commit-bundle'||!original.bundle?.length)fail('UNDO_UNAVAILABLE','No applied authoring bundle to undo.');const bundle=[];for(const row of original.bundle){const current=await this.raw(parseMarkdown(row.after).id);if(current.text!==row.after)fail('VERSION_CONFLICT','Newer revisions prevent this undo.');let after=null;if(row.before!==null){const record=parseMarkdown(row.before);record.revision=current.record.revision+1;syncCultureSourceRevision(record);after=renderMarkdown(record);}bundle.push({path:row.path,before:current.text,after});}const affected=bundle.map(row=>parseMarkdown(row.before).id),finalRows=[...(await this.all()).filter(row=>!affected.includes(row.record.id)),...bundle.filter(row=>row.after!==null).map(row=>({record:parseMarkdown(row.after)}))];for(const row of finalRows)await this.validateReferences(row.record,finalRows);const receipt={operationId:request.operationId,fingerprint,kind:'undo-commit-bundle',status:'applied',recordId:affected[0],recordIds:affected,undoOf:request.commitId,bundleHash:hash(bundle),bundle,at:new Date().toISOString()};await check?.();await runFenceFor(this.root)?.check();const pending={bundle,receipt};await this.atomic('.journal/pending/'+request.operationId+'.json',JSON.stringify(pending,null,2));await this.fault?.('after-commit-journal',pending);await this.recoverCommit(pending,request.operationId+'.json');return receipt;});}
 async undo(operationId,input,authority){
  id.parse(operationId);id.parse(input.operationId);if(authority?.role!=='assistant')fail('WRITE_DENIED','Undo is an author operation.');const fingerprint=hash({undo:operationId,input});
  return this.serial(async()=>{
   const prior=await this.receipt(input.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Undo ID reused.');return {...prior,replayed:true};}
   const receipt=await this.receipt(operationId);
   if(receipt?.kind==='create'&&receipt.before===null){
    const row=await this.raw(receipt.recordId);if(row.hash!==input.expectedHash||row.hash!==receipt.afterHash)fail('VERSION_CONFLICT','Created record changed; preserve its later revisions.');
    const rows=await this.all();if(rows.some(other=>other.record.id!==receipt.recordId&&references(other.record).some(([target])=>target===receipt.recordId))||(await this.history()).some(other=>other.evidenceIds?.includes(receipt.recordId)))fail('REFERENCE_INVALID','Accepted records or provenance refer to this created record.');
    const result={operationId:input.operationId,fingerprint,status:'applied',recordId:row.record.id,revision:row.record.revision+1,beforeHash:row.hash,afterHash:null,before:row.text,after:null,kind:'remove-created',undoOf:operationId,role:'assistant',at:new Date().toISOString()},pending={path:'records/'+row.record.id+'.md',before:row.text,after:null,receipt:result};
    await this.atomic('.journal/pending/'+input.operationId+'.json',JSON.stringify(pending,null,2));await this.fault?.('after-journal',pending);await fs.unlink(await this.resolveSource(pending.path));await this.fault?.('after-record',pending);await this.atomic('.journal/receipts/'+input.operationId+'.json',JSON.stringify(result,null,2));await fs.unlink(path.join(this.root,'.journal/pending',input.operationId+'.json'));return result;
   }
   if(receipt?.kind==='remove-created'&&receipt.before){
    if(input.expectedHash!==null||(await this.all()).some(row=>row.record.id===receipt.recordId))fail('VERSION_CONFLICT','Restore only when the stable ID is still absent.');
    const restored=parseMarkdown(receipt.before);restored.revision=receipt.revision+1;return this.publish(null,restored,input.operationId,fingerprint,{role:'assistant',kind:'restore-created',undoOf:operationId});
   }
   if(!receipt?.before)fail('UNDO_UNAVAILABLE','No prior content to restore.');const row=await this.raw(receipt.recordId);
   if(row.hash!==input.expectedHash||row.hash!==receipt.afterHash)fail('VERSION_CONFLICT','Newer changes prevent this undo.');const restored=parseMarkdown(receipt.before);restored.revision=row.record.revision+1;return this.publish(row.text,restored,input.operationId,fingerprint,{role:'assistant',undoOf:operationId});
  });
 }
 async history(){await this.checkInternal('.journal/receipts');return (await Promise.all((await fs.readdir(path.join(this.root,'.journal/receipts'))).filter(name=>name.endsWith('.json')).map(async name=>{const r=JSON.parse(await this.journalRead('receipts',name.slice(0,-5)));const {before,after,bundle,...publicReceipt}=r;return publicReceipt;}))).flatMap(receipt=>receipt.kind==='commit-bundle'?[receipt,...receipt.effects.map(effect=>({...effect,parentOperationId:receipt.operationId,provenance:receipt.provenance}))]:[receipt]);}
 async projection(){const rows=await this.all();return {authority:'markdown',version:hash(rows.map(row=>[row.record.id,row.hash])),records:rows.map(row=>({id:row.record.id,type:row.record.type,name:row.record.name,revision:row.record.revision,hash:row.hash,references:references(row.record)}))};}
 async saveRun(run){id.parse(run.id);const payload=JSON.stringify(run,null,2),fence=runFenceFor(this.root),write=async()=>{if(fence&&fence.runId===run.id)await fence.check({allowStop:true});await this.atomic('.journal/runs/'+run.id+'.json',payload);};if(writerScope.getStore()===this.root)return write();return this.serial(write);}
 async loadRun(runId){return JSON.parse(await this.journalRead('runs',runId));}
 async runs(){await this.checkInternal('.journal/runs');const names=await fs.readdir(path.join(this.root,'.journal/runs'));if(names.length>1000)fail('BUDGET_EXCEEDED','Fixture run history exceeds its budget.');return Promise.all(names.filter(name=>/^[a-z][a-z0-9_-]{0,79}\.json$/.test(name)).map(name=>this.loadRun(name.slice(0,-5))));}
}
