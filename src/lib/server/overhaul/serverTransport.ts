import type {ServerGenerationOptions,generateServerTextWithMetrics} from '$lib/server/turn/provider';
import {createCampaignTransport} from './transport.mjs';
import {createConfiguredCampaignTransport} from './providerRuntime.mjs';
/** Existing injection compatibility, still synthetic/keyless. */
export function createServerCampaignTransport(generation:Pick<ServerGenerationOptions,'profile'|'model'|'maxTokens'|'timeoutMs'>,generate:typeof generateServerTextWithMetrics){if(generation.profile.apiKey)throw new Error('Credential-bearing transport is disabled in isolated qualification.');return createCampaignTransport({...generation,generate,name:'Server generation protocol (injected)',paid:false});}
/** The real existing provider owner is loaded only after a private host dispatch capability.
 * Campaign settings and browser/MCP tool arguments cannot grant this capability. */
export function createServerProviderRuntime(store:any,runtime:{generateSynthetic:typeof generateServerTextWithMetrics;allowProvider?:boolean;resolveCredential?:(reference:string)=>Promise<string>;resolvePricing?:(profile:any)=>Promise<any>}){
 return createConfiguredCampaignTransport(store,{...runtime,generateProvider:async(options:ServerGenerationOptions)=>{if(!runtime.allowProvider)throw new Error('Provider dispatch is disabled.');const {generateServerTextWithMetrics}=await import('$lib/server/turn/provider');return generateServerTextWithMetrics(options);}});
}