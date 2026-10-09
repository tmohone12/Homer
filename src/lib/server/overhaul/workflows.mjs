import {z} from 'zod';
import {locationSaveArgsSchema} from '../../contracts/locationLore.ts';
import {hash,StoreError,validateRecord,renderMarkdown,parseMarkdown,dataSchemas} from './store.mjs';
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),digest=z.string().regex(/^[a-f0-9]{64}$/),author={role:'assistant'};
const fail=(code,message)=>{throw new StoreError(code,message);};
export function patchCandidate(record,patch){
 const candidate=structuredClone(record);
 for(const [field,value]of Object.entries(patch)){
  if(!/^data\.[A-Za-z]+(?:\.[A-Za-z]+)?$/.test(field))fail('FIELD_DENIED','Use a typed data field.');
  const parts=field.split('.');if(parts.some(p=>['__proto__','constructor','prototype'].includes(p))||(parts.length===2&&['identity','current','house','geography','politics'].includes(parts[1])))fail('FIELD_DENIED','Whole state/identity replacement is denied.');
  let target=candidate;for(const part of parts.slice(0,-1)){if(!Object.hasOwn(target,part)||!target[part]||typeof target[part]!=='object')fail('FIELD_DENIED','Unknown data field.');target=target[part];}
  const key=parts.at(-1);if(!Object.hasOwn(target,key)&&!(parts.length===2&&Object.hasOwn(dataSchemas[candidate.type].shape,key)))fail('FIELD_DENIED','Unknown data field.');target[key]=structuredClone(value);
 }return validateRecord(candidate);
}
// Explicit author acceptance establishes evidence; agent proposals cannot call this
// entry point to grant themselves evidence authority.
export async function ingestAcceptedEvent(store,input,authority){
 if(authority?.role!=='assistant')fail('WRITE_DENIED','Only an author-established source event is accepted here.');
 const request=z.object({operationId:id,event:z.unknown(),expectedHashes:z.record(id,digest),preexistingEvent:z.boolean().optional()}).strict().parse(input),event=validateRecord(request.event);
 if(event.type!=='event'||event.revision!==1)fail('EVENT_INVALID','Supply a revision-one source event.');
 const fingerprint=hash(request),runId='ingest_'+hash(request.operationId).slice(0,40);
 const descriptor=await store.serial(async()=>{
  const prior=await store.loadRun(runId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Ingestion ID reused.');return prior;}
  const rows=await store.all(),groups=Object.create(null);await store.validateReferences(event,rows);const existingEvent=rows.find(row=>row.record.id===event.id);if(existingEvent&&(!request.preexistingEvent||hash(existingEvent.record)!==hash(event)))fail('ID_CONFLICT','Event ID exists or differs.');
  for(const assertion of event.data.assertions){const patch=groups[assertion.subjectId]||={};if(Object.hasOwn(patch,assertion.field)&&hash(patch[assertion.field])!==hash(assertion.value))fail('EVENT_INVALID','Conflicting assertions within one source event.');patch[assertion.field]=assertion.value;}
  for(const [subjectId,patch]of Object.entries(groups)){const row=rows.find(r=>r.record.id===subjectId);if(request.expectedHashes[subjectId]!==row.hash)fail('VERSION_CONFLICT','Event subject changed; reread before accepting it.');const candidate=patchCandidate(row.record,patch);await store.validateReferences(candidate,[...rows,{record:event}]);if(hash(parseMarkdown(renderMarkdown(candidate)))!==hash(candidate))fail('INVALID_MARKDOWN','Source assertion cannot roundtrip.');}
  const next={id:runId,kind:'event-ingestion',fingerprint,status:'accepted-pending',request,groups,receipts:[],at:new Date().toISOString()};await store.saveRun(next);return next;
 });
 if(descriptor.status==='completed')return {...descriptor,replayed:true};
 if(!request.preexistingEvent)await store.create({operationId:'source_'+hash(request.operationId).slice(0,40),record:event},author);
 // Related domain fields share one journaled publication. Protected identity
 // assertions remain separate so a conflict cannot suppress unrelated state.
 const receipts=[];for(const [subjectId,patch]of Object.entries(descriptor.groups)){
  let expectedHash=request.expectedHashes[subjectId];const batches=new Map();
  for(const [field,value]of Object.entries(patch)){
   const group=field.startsWith('data.politics.')?'politics':
    ['data.accessHouseIds','data.accessRights'].includes(field)?'resource-access':field;
   if(!batches.has(group))batches.set(group,{});batches.get(group)[field]=value;
  }
  for(const batch of batches.values()){
   const fields=Object.keys(batch).sort(),signature=fields.length===1?fields[0]:fields;
   const receipt=await store.edit({id:subjectId,operationId:'apply_'+hash([request.operationId,subjectId,signature]).slice(0,40),expectedHash,patch:batch,evidenceIds:[event.id]},{role:'gm'});
   receipts.push(receipt);if(receipt.afterHash)expectedHash=receipt.afterHash;
  }
 }
 const result={...descriptor,status:'completed',receipts};await store.serial(()=>store.saveRun(result));return result;
}
export async function saveLocation(store,input,authority){
 if(authority?.role!=='assistant')fail('WRITE_DENIED','Location workspace edits require the author.');
 const request=z.object({operationId:id,args:locationSaveArgsSchema}).strict().parse(input),args=request.args,fingerprint=hash(request),runId='location_'+hash(request.operationId).slice(0,40);
 const descriptor=await store.serial(async()=>{
  const prior=await store.loadRun(runId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_CONFLICT','Location save ID reused.');return prior;}
  const row=await store.raw(args.locationId);if(row.record.type!=='location')fail('REFERENCE_INVALID','Not a location.');if(row.record.revision!==args.expectedVersion)fail('VERSION_CONFLICT','Location revision changed.');
  const patch={};if(args.parentLocationId!==undefined)patch['data.geography.parentId']=args.parentLocationId;if(args.locationKind!==undefined)patch['data.geography.kind']=args.locationKind;
  if(args.lore){const fact={...args.lore,id:args.lore.id||'fact_'+hash(request.operationId).slice(0,32)};id.parse(fact.id);if(fact.validToTurn!=null&&fact.validToTurn<(fact.validFromTurn??0))fail('LORE_INVALID','Lore ends before it begins.');patch['data.loreFacts']=[...(row.record.data.loreFacts||[]).filter(f=>f.id!==fact.id),fact];}
  const candidate=patchCandidate(row.record,patch);await store.validateReferences(candidate,await store.all());
  const next={id:runId,kind:'location-save',fingerprint,at:new Date().toISOString(),edit:{id:args.locationId,operationId:request.operationId,expectedHash:row.hash,patch,evidenceIds:[]}};await store.saveRun(next);return next;
 });return store.edit(descriptor.edit,author);
}
export async function locationContext(store,locationId,{atTurn=0,authority=author}={}){
 id.parse(locationId);z.number().int().nonnegative().parse(atTurn);
 const chain=[],warnings=[],seen=new Set();let current=locationId;
 while(current){
  if(seen.has(current)){warnings.push('Malformed containment edge.');break;}seen.add(current);const row=await store.raw(current);if(row.record.type!=='location')fail('REFERENCE_INVALID','Not a location edge.');
  if(!store.visible(row.record,authority)){warnings.push('Private containment edge.');break;}
  const record=structuredClone(row.record),parent=record.data.geography.parentId;
  if(parent){const other=await store.raw(parent);if(!store.visible(other.record,authority)){record.data.geography.parentId=null;chain.unshift(record);warnings.push('Private containment edge.');break;}}
  chain.unshift(record);current=parent;
 }
 const eligible=chain.flatMap(record=>(record.data.loreFacts||[]).filter(f=>(record.id===locationId||f.locationLore.scope==='descendants')&&(f.validFromTurn??0)<=atTurn&&(f.validToTurn==null||atTurn<f.validToTurn)).map(f=>({...f,ownerId:record.id,inherited:record.id!==locationId})));
 const excepted=new Set(eligible.flatMap(f=>f.locationLore.exceptionToFactIds));
 return {locationId,atTurn,chain,facts:eligible.filter(f=>!excepted.has(f.id)),exceptedFactIds:[...excepted],warnings,incomplete:warnings.length>0};
}
export async function migrationDryRun(store,documents){
 const bundle=await store.validateBundle(documents);
 return {authority:'markdown',recordCount:bundle.length,bundleHash:hash(bundle),records:bundle.map(row=>({id:parseMarkdown(row.after).id,path:row.path,sha256:hash(row.after)})),writes:0};
}
