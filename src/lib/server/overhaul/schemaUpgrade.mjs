import {hash,StoreError} from './store.mjs';
// No campaign path discovery: callers must already own a synthetic store.
export function prepareSyntheticDomainData(record){
 const d=structuredClone(record.data);
 if(record.type==='location'){
  d.politics.claims=d.politics.claims.map(c=>typeof c==='string'?{id:'legacy_claim_'+c,houseId:c,basis:'Imported synthetic claim; basis and date were not recorded.',status:'asserted',evidenceIds:[],knownBy:[],visibility:'public',from:null,until:null}:c);
  d.politics.controlHistory||=[]; // Never invent an occupation or its date.
 }
 if(record.type==='resource')d.accessRights||=d.accessHouseIds.map(houseId=>({id:'legacy_access_'+houseId,houseId,kind:'unspecified',scope:'Existing synthetic access; its terms were not recorded.',evidenceIds:[],knownBy:[],visibility:'public',from:null,until:null}));
 if(record.type==='character')for(const c of d.knowledge){
  c.acquisitions||=c.kind==='belief'?[]:c.knownBy.map(actorId=>({actorId,method:c.kind==='witnessed'?'witnessed':'unspecified',fromActorId:null,worldTime:null,evidenceIds:[...c.evidenceIds],confidence:c.confidence,visibility:c.visibility}));
  c.beliefProvenance||=c.kind==='belief'?c.knownBy.map(actorId=>({actorId,basisEvidenceIds:[...c.evidenceIds],sourceActorId:null,worldTime:null,reason:'Existing synthetic belief; its rationale was not recorded.',assessment:'unverified',confidence:c.confidence,visibility:c.visibility})):[];
 }
 return d;
}
export async function upgradeSyntheticDomainSchemas(store,{qualificationFixture=false}={}){
 if(qualificationFixture!==true)throw new StoreError('MIGRATION_DENIED','Private campaigns cannot enter the synthetic schema upgrader.');
 const receipts=[];for(const row of await store.all())if(row.record.schemaVersion===1&&['character','location','resource'].includes(row.record.type))receipts.push(await store.upgradeSyntheticSchema({id:row.record.id,operationId:'schema_v2_'+hash([row.record.id,row.hash]).slice(0,40),expectedHash:row.hash,data:prepareSyntheticDomainData(row.record)},{role:'assistant',qualificationFixture:true}));
 return {schemaVersion:2,receipts,privateCampaignMigration:false};
}
