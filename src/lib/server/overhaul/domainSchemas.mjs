import {z} from 'zod';
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),ref=id.nullable(),ids=z.array(id).max(100),time=z.string().max(100).nullable(),confidence=z.number().min(0).max(1),visibility=z.enum(['public','secret']);
const provenance={evidenceIds:ids,knownBy:ids,visibility,from:time,until:time};
export const politicalClaimSchema=z.object({id,houseId:id,basis:z.string().max(4000),status:z.enum(['asserted','recognized','disputed','withdrawn']),...provenance}).strict();
export const controlHistorySchema=z.object({id,controllerHouseId:ref,recognizedRulerHouseId:ref,mode:z.enum(['occupation','stewardship','inheritance','treaty','independence','unspecified']),...provenance}).strict();
export const accessRightSchema=z.object({id,houseId:id,kind:z.enum(['permission','treaty','lease','custom','seizure','unspecified']),scope:z.string().max(1000),...provenance}).strict();
export const acquisitionSchema=z.object({actorId:id,method:z.enum(['witnessed','told','read','inferred','unspecified']),fromActorId:ref,worldTime:time,evidenceIds:ids,confidence,visibility}).strict();
export const beliefProvenanceSchema=z.object({actorId:id,basisEvidenceIds:ids,sourceActorId:ref,worldTime:time,reason:z.string().max(4000),assessment:z.enum(['unverified','supported','disputed']),confidence,visibility}).strict();
export const knowledgeClaimSchema=z.object({id,text:z.string().max(4000),kind:z.enum(['learned','witnessed','belief']),knownBy:ids,evidenceIds:ids,confidence,visibility,acquisitions:z.array(acquisitionSchema).max(100).optional(),beliefProvenance:z.array(beliefProvenanceSchema).max(100).optional()}).strict();
export const politicsSchema=z.object({rulingHouseId:ref,controllerHouseId:ref,claims:z.array(z.union([id,politicalClaimSchema])).max(100),controlHistory:z.array(controlHistorySchema).max(100).optional()}).strict();
export const resourceDataSchema=z.object({description:z.string().max(4000),amount:z.number().finite().nonnegative(),unit:z.string().max(100),locationId:id,ownerHouseId:ref,controllerHouseId:ref,accessHouseIds:ids,accessRights:z.array(accessRightSchema).max(100).optional()}).strict();
export function domainVersionProblems(record){
 const errors=[],unique=(items,label)=>{if(new Set(items).size!==items.length)errors.push('Duplicate '+label);},d=record.data;
 if(record.type==='character')for(const claim of d.knowledge){
  unique(claim.knownBy,'claim actor');unique((claim.acquisitions||[]).map(p=>p.actorId),'acquisition actor');unique((claim.beliefProvenance||[]).map(p=>p.actorId),'belief actor');
  for(const p of [...claim.acquisitions||[],...claim.beliefProvenance||[]])if(!claim.knownBy.includes(p.actorId))errors.push('Provenance actor must know the claim');
  if(claim.kind!=='belief'&&claim.beliefProvenance?.length)errors.push('Belief provenance belongs only to belief claims');
  if(record.schemaVersion===2){
   if(!Array.isArray(claim.acquisitions)||!Array.isArray(claim.beliefProvenance))errors.push('Version 2 knowledge requires acquisition and belief provenance arrays');
   const collection=claim.kind==='belief'?claim.beliefProvenance:claim.acquisitions;
   if(claim.knownBy.some(actor=>!collection?.some(p=>p.actorId===actor)))errors.push('Every knowing actor requires personal provenance');
  }
 }
 if(record.type==='location'){
  if(record.schemaVersion===2&&(!Array.isArray(d.politics.controlHistory)||d.politics.claims.some(c=>typeof c==='string')))errors.push('Version 2 politics requires structured claims and control history');
  unique(d.politics.claims.map(c=>typeof c==='string'?c:c.id),'political claim');unique((d.politics.controlHistory||[]).map(c=>c.id),'control history');
  const active=(d.politics.controlHistory||[]).filter(c=>c.until===null);if(active.length>1)errors.push('Only one current control interval');
  if(active.some(c=>c.controllerHouseId!==d.politics.controllerHouseId||c.recognizedRulerHouseId!==d.politics.rulingHouseId))errors.push('Current control interval must match this location, never its parent');
 }
 if(record.type==='resource'){
  if(record.schemaVersion===2&&!Array.isArray(d.accessRights))errors.push('Version 2 resources require access provenance');
  unique((d.accessRights||[]).map(c=>c.id),'access right');unique(d.accessHouseIds,'access house');
  if((d.accessRights||[]).some(c=>c.until===null&&!d.accessHouseIds.includes(c.houseId)))errors.push('Current access right requires explicit access');
 }
 return errors;
}
