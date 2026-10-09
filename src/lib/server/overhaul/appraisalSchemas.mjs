import {z} from 'zod';
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),labels=z.array(z.string().trim().min(1).max(80)).min(1).max(30).refine(rows=>new Set(rows).size===rows.length,'Labels must be unique.');
export const appraisalTemplateSchema=z.object({id,version:z.number().int().positive(),judgments:labels,requireIntensity:z.boolean().default(false),intensity:z.object({min:z.number().int().min(1).max(5),max:z.number().int().min(1).max(5)}).strict().refine(r=>r.min<=r.max),relationshipDelta:z.object({min:z.number().int().min(-2).max(2),max:z.number().int().min(-2).max(2)}).strict().refine(r=>r.min<=0&&r.max>=0),triage:labels.optional(),allowVisibleTic:z.boolean().default(true)}).strict();
export const appraisalPolicySchema=z.object({enabled:z.boolean(),template:appraisalTemplateSchema}).strict();
/** Examples only. No mandatory trauma response, agent cast or automatic activation. */
export const appraisalPresets={
 classic:{id:'classic_appraisal',version:1,judgments:['Threatened','Insulted','Amused','Validated','Indifferent'],requireIntensity:true,intensity:{min:1,max:5},relationshipDelta:{min:-2,max:2},triage:['Fight','Flight','Freeze','Fawn','Deliberate','Cooperate','Hold'],allowVisibleTic:true},
 social:{id:'social_appraisal',version:1,judgments:['Pleased','Offended','Wary','Intrigued','Indifferent'],requireIntensity:false,intensity:{min:1,max:5},relationshipDelta:{min:-1,max:1},triage:['Deliberate','Cooperate','Hold'],allowVisibleTic:true}
};
export const appraisalEffectSchema=z.object({effectId:id,eventId:id,templateId:id,templateVersion:z.number().int().positive(),delta:z.number().int().min(-2).max(2)}).strict();
export const relationshipAppraisalSchema=z.object({actorId:id,affinity:z.number().int().min(-100).max(100),effects:z.array(appraisalEffectSchema).max(100)}).strict();
