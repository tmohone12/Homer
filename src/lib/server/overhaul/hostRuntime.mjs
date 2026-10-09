import {loadHomerConfig} from './resources.mjs';
import {ProviderCatalog,catalogHosts} from './providerCatalog.mjs';
import {createHomerProviderAdapter,assertHomerProvider} from './providerAdapter.mjs';
import {StoreError} from './store.mjs';

/** Host-only bootstrap. Campaign files and prompt edits cannot grant dispatch.
 * No credential is read until an explicitly granted provider request needs it. */
export async function loadHomerHost(root,{grantProvider=false,fetcher,recorded=false,resolveCredential,resolvePricing,resources,operator}={}){
 const config=await loadHomerConfig(root),allowProvider=config.runtimeMode==='provider'&&config.providerDispatch&&grantProvider===true;
 if(recorded&&!fetcher)throw new StoreError('PROVIDER_CONFIG','Recorded host mode requires a private mock fetch transport.');
 const catalog=new ProviderCatalog(),credentialResolver=resolveCredential||(operator?operator.resolveCredential.bind(operator):null)|| (async reference=>{if(!config.credentialRefs.includes(reference))throw new StoreError('CREDENTIAL_UNAVAILABLE','Credential reference is not in the host allowlist.');const value=process.env['HOMER_CREDENTIAL_'+reference.toUpperCase()];if(!value)throw new StoreError('CREDENTIAL_UNAVAILABLE','The configured host credential is unavailable.');return value;}),pricingResolver=resolvePricing||(async profile=>{assertHomerProvider(profile);const result=await catalog.get({provider:profile.providerType});const model=result.models.find(row=>row.id===profile.model);if(result.status!=='ready'||!model||model.pricing.input===null||model.pricing.output===null||Math.min(200000,model.contextTokens)!==profile.contextWindowTokens)throw new StoreError('PRICE_UNVERIFIED','Current provider metadata does not establish the selected price/context bounds.');return {source:catalogHosts[profile.providerType]+'/models',model:model.id,inputUsdPerMillion:model.pricing.input,outputUsdPerMillion:model.pricing.output};});
 return {operatorSetup:!!operator,allowSynthetic:!operator,runtimeMode:config.runtimeMode,hostConfig:config,resourceRoot:root,resources,allowProvider,providerSimulation:recorded,providerGuard:profile=>{operator?.assertReady(profile);assertHomerProvider(profile);},generateProvider:createHomerProviderAdapter({fetcher,recorded,dispatchGranted:allowProvider}),resolveCredential:credentialResolver,resolvePricing:pricingResolver};
}
