import {z} from 'zod';
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),ref=id.nullable(),base={id,name:z.string().trim().min(1).max(200),visibility:z.enum(['public','secret']).default('public')};
const schema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('house')}).strict(),
 z.object({...base,type:z.literal('culture')}).strict(),
 z.object({...base,type:z.literal('character'),locationId:ref.default(null),birthHouseId:ref.default(null)}).strict(),
 z.object({...base,type:z.literal('location'),parentId:ref.default(null),kind:z.enum(['continent','region','city','castle','district','building','room','site','wilderness','other']).default('site')}).strict(),
 z.object({...base,type:z.literal('resource'),locationId:id,ownerHouseId:ref.default(null),controllerHouseId:ref.default(null),amount:z.number().finite().nonnegative().default(0),unit:z.string().trim().min(1).max(100).default('units')}).strict(),
 z.object({...base,type:z.literal('faction'),houseId:ref.default(null)}).strict()
]);
/** Shared author-facing blank templates. Unknown history/permissions stay
 * empty; containment never supplies political control or resource rights. */
export function buildWorldDraft(input){const draft=schema.parse(input);let data;
 if(draft.type==='culture')data={source:{document:'records/'+draft.id+'.md',anchor:draft.id,revision:'1',visibility:['gm'],knownBy:[]},inherits:[],related:[],norms:[],cues:[],variants:[],knownBy:[]};
 if(draft.type==='house')data={background:'',culture:'',goals:[]};
 if(draft.type==='character')data={background:'',appearance:'',current:{locationId:draft.locationId,roleTitle:'',condition:'',allegianceHouseId:null},goals:[],house:{birthId:draft.birthHouseId,currentId:null,swornId:null},identity:{parentIds:[],originId:null,species:''},knowledge:[],relationships:[]};
 if(draft.type==='location')data={geography:{kind:draft.kind,parentId:draft.parentId},politics:{rulingHouseId:null,controllerHouseId:null,claims:[],controlHistory:[]},culture:'',wealth:'',defenses:'',lore:'',loreFacts:[]};
 if(draft.type==='resource')data={description:'',amount:draft.amount,unit:draft.unit,locationId:draft.locationId,ownerHouseId:draft.ownerHouseId,controllerHouseId:draft.controllerHouseId,accessHouseIds:[],accessRights:[]};
 if(draft.type==='faction')data={houseId:draft.houseId,goals:[],intentions:[],projects:[]};
 return {schemaVersion:['character','location','resource'].includes(draft.type)?2:1,id:draft.id,type:draft.type,name:draft.name,revision:1,visibility:draft.visibility,data};
}
