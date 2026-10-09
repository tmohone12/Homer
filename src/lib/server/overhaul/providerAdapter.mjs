import {encode} from 'gpt-tokenizer';
import {readCampaignProviderStream} from './providerStream.mjs';
import {buildProviderRequest,normalizeProviderUsage} from './promptCaching.mjs';
import {catalogHosts} from './providerCatalog.mjs';
import {StoreError} from './store.mjs';

export function assertHomerProvider(profile){if(!Object.hasOwn(catalogHosts,profile.providerType)||profile.baseUrl?.replace(/\/$/,'')!==catalogHosts[profile.providerType])throw new StoreError('PROVIDER_HOST_DENIED','This adapter supports the configured fixed OpenRouter/NanoGPT API hosts only.');}
/** Homer wire adapter around the existing serializer, tokenizer and inherited
 * SSE reader. It owns no model loop, settings store, credentials or retry loop.
 * Recorded qualification swaps only fetch; the complete runtime remains shared. */
export function createHomerProviderAdapter({fetcher=fetch,dispatchGranted=false,recorded=false}={}){
 if(recorded&&fetcher===fetch)throw new StoreError('PROVIDER_CONFIG','Recorded qualification requires an injected non-network fetch transport.');
 return async options=>{
  if(!dispatchGranted)throw new StoreError('PROVIDER_DISABLED','Host dispatch grant is absent.');assertHomerProvider(options.profile);
  if(!recorded&&!options.profile.apiKey)throw new StoreError('CREDENTIAL_UNAVAILABLE','A provider credential reference must resolve before dispatch.');
  const startTime=Date.now(),request=options.providerRequest||buildProviderRequest(options,{...options.profile,model:options.model},{campaignScope:'explicit-host-adapter'});if(!request||request.endpoint!==catalogHosts[options.profile.providerType]+'/chat/completions')throw new StoreError('PROVIDER_HOST_DENIED','Provider request endpoint is outside the configured adapter.');
  const serializedBody=JSON.stringify(request.body);if(serializedBody!==request.serializedBody)throw new StoreError('PROVIDER_PROTOCOL','Serialized provider request differs from its checkpoint.');
  const inputTokens=encode(serializedBody).length+512,reservedOutputTokens=options.maxTokens;if(inputTokens+reservedOutputTokens>options.profile.contextWindowTokens)throw new StoreError('CONTEXT_BUDGET','Serialized provider request exceeds its configured context allowance.');
  if(options.signal?.aborted)throw new StoreError('CANCELLED','Provider request stopped before checkpoint.');
  await options.onBeforeRequest({serializedBody,inputTokens,reservedOutputTokens,contextWindowTokens:options.profile.contextWindowTokens});if(options.signal?.aborted)throw new StoreError('CANCELLED','Provider request stopped before dispatch.');
  const headers={'Content-Type':'application/json',Accept:'text/event-stream'};if(options.profile.apiKey)headers.Authorization='Bearer '+options.profile.apiKey;
  const response=await fetcher(request.endpoint,{method:'POST',redirect:'error',headers,body:serializedBody,signal:options.signal});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new StoreError('PROVIDER_HTTP','Provider returned HTTP '+response.status+'.');}
  if(!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')){await response.body?.cancel().catch(()=>{});throw new StoreError('PROVIDER_PROTOCOL','Expected the selected streaming provider contract.');}
  const result=await readCampaignProviderStream(response,{onTextDelta:options.onTextDelta,normalizeUsage:packet=>normalizeProviderUsage(packet.usage),signal:options.signal,startTime}),usage=normalizeProviderUsage(result.usage);
  return {...result,message:{role:'assistant',content:result.text,...(result.toolCalls.length?{toolCalls:result.toolCalls}:{}),...(Object.keys(result.providerContinuation).length?{providerContinuation:result.providerContinuation}:{})},usage,model:options.model,endpoint:request.endpoint,durationMs:Date.now()-startTime,promptChars:serializedBody.length,responseChars:result.text.length,dispatchMode:recorded?'recorded':'provider'};
 };
}
