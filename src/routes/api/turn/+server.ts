import {json,type RequestHandler} from '@sveltejs/kit';
import {campaignService,campaignRequestScope} from '$lib/server/overhaul/service.mjs';
import {readCampaignBody,campaignTurnCommand} from '$lib/server/overhaul/turn.mjs';
export const POST:RequestHandler=async({request})=>{try{return json(await campaignTurnCommand(await campaignService(campaignRequestScope(request)),await readCampaignBody(request)));}catch(error:any){return json({error:error.message,code:error.code||'INVALID_REQUEST'},{status:['BUSY','VERSION_CONFLICT','QUESTION_PENDING'].includes(error.code)?409:400});}};