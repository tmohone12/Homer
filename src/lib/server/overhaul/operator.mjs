import {z} from 'zod';
import {StoreError} from './store.mjs';
const provider=z.enum(['openrouter','nanogpt']);
/** Dedicated local installation only. Operator-entered keys live in memory;
 * no environment credential reads, source/journal writes or validation calls.
 * Models and campaign tools never receive this capability. */
export class HomerOperator{
 constructor(){this.accounts=new Map();}
 status(){return {available:true,storage:'memory-only',accounts:['openrouter','nanogpt'].map(id=>({provider:id,configured:this.accounts.has(id),enabled:this.accounts.get(id)?.enabled===true})),rule:'Keys are forgotten when Homer restarts. Saving an account makes no provider call. User-submitted play uses the selected provider and saved budgets.'};}
 async command(input){const request=z.discriminatedUnion('intent',[z.object({intent:z.literal('status')}).strict(),z.object({intent:z.literal('configure'),provider,key:z.string().trim().min(1).max(4096).refine(v=>!/[\r\n\0]/.test(v)),enableUserPlay:z.boolean()}).strict(),z.object({intent:z.literal('disconnect'),provider}).strict()]).parse(input);if(request.intent==='configure')this.accounts.set(request.provider,{key:request.key,enabled:request.enableUserPlay});if(request.intent==='disconnect')this.accounts.delete(request.provider);return this.status();}
 assertReady(profile){if(!provider.safeParse(profile.providerType).success)throw new StoreError('PROVIDER_SETUP_REQUIRED','Choose OpenRouter or NanoGPT and save a model profile in Controls → Settings.');const account=this.accounts.get(profile.providerType);if(!account?.key||!account.enabled||profile.credentialRef!=='operator_'+profile.providerType)throw new StoreError('PROVIDER_SETUP_REQUIRED','Connect this provider account and explicitly enable user-initiated play in Controls → Settings. Keys are session-only.');}
 async resolveCredential(reference,{signal}={}){if(signal?.aborted)throw new StoreError('CANCELLED','Provider setup stopped.');const entry=[...this.accounts.entries()].find(([id])=>reference==='operator_'+id);if(!entry||!entry[1].enabled)throw new StoreError('CREDENTIAL_UNAVAILABLE','Provider account is not connected for this Homer session.');return entry[1].key;}
}
