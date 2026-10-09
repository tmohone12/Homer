import {publicRun} from './engine.mjs';
import {z} from 'zod';import {hash,StoreError} from './store.mjs';
/** Compatibility query entry point over the same editable authoring loop.
 * Dispatch, resource pins, questions and proposals remain owned by CampaignEngine. */
export async function askAssistant(service,input){
 const request=z.object({operationId:z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),question:z.string().trim().min(1).max(2000)}).strict().parse(input),runId='assistant_'+hash(request.operationId).slice(0,40);
 if(!service.authoring||typeof service.engine?.start!=='function')throw new StoreError('AUTHOR_RUNTIME_REQUIRED','Assistant requests require the shared campaign runtime.');
 await service.engine.start({id:runId,action:'author',text:request.question});
 return publicRun(await service.engine.wait(runId));
}
