import {bindCampaignMemory} from './memoryLifecycle.mjs';
import {AuthoringWorkspace} from './authoring.mjs';
import {ChildResources} from './childResources.mjs';
import {createModelChildWorker} from './childWorker.mjs';
import {GmResources,homerSourceRoot} from './resources.mjs';
import {ProviderCatalog} from './providerCatalog.mjs';
import {AgentWorkspace} from './agentWorkspace.mjs';
import {MarkdownStore} from './store.mjs';import {CampaignEngine} from './engine.mjs';import {CampaignSandbox} from './sandbox.mjs';import {MemWeaveAdapter} from './memweave.mjs';import {createConfiguredCampaignTransport} from './providerRuntime.mjs';import {defaultCampaign} from './controlSchemas.mjs';import {syntheticCampaignGeneration} from './syntheticTransport.mjs';import {upgradeSyntheticDomainSchemas} from './schemaUpgrade.mjs';
/** Host-only factory shared by browser/CLI/MCP. Source roots and optional
 * provider/memory capabilities never come from campaign or tool arguments. */
export async function createCampaignRuntime({storyRoot,allowedRoot,seedRecords=[],name='Untitled campaign',example=false,capabilities={},fault}={}){
 const store=await new MarkdownStore(storyRoot,{allowedRoot}).init();await store.seed(seedRecords);
 if(!(await store.all()).some(row=>row.record.id==='campaign')){const record=defaultCampaign();record.name=name;if(capabilities.runtimeMode)record.data.settings.mode=capabilities.runtimeMode;if(capabilities.operatorSetup){record.data.settings.profiles=[{id:'setup',name:'Account and model setup required',providerType:'openrouter',baseUrl:'https://openrouter.ai/api/v1',model:'setup-required',credentialRef:'operator_openrouter',contextWindowTokens:null,inputUsdPerMillion:null,outputUsdPerMillion:null,priceSource:'simulation'}];record.data.settings.selection={gm:'setup',npc:'setup',assistant:'setup'};}if(!example){record.data.description='';record.data.playerId=null;record.data.activePovId=null;record.data.sceneLocationId=null;}await store.create({operationId:'initialize_campaign_controls',record},{role:'assistant'});}
 if(example){if(!(await store.all()).some(row=>row.record.id==='reedhaven')&&seedRecords.some(record=>record.id==='reedhaven'))await store.create({operationId:'fixture_reedhaven_v2',record:seedRecords.find(record=>record.id==='reedhaven')},{role:'assistant'});await upgradeSyntheticDomainSchemas(store,{qualificationFixture:true});}
 const resources=capabilities.resources||await new GmResources(capabilities.resourceRoot||homerSourceRoot()).init();
 const assistantResources=await new GmResources(resources.root,{role:'assistant'}).init();
 const sandbox=capabilities.sandbox||new CampaignSandbox(store),transport=createConfiguredCampaignTransport(store,{generateSynthetic:capabilities.generateSynthetic||syntheticCampaignGeneration,generateProvider:capabilities.generateProvider,allowProvider:capabilities.allowProvider===true,resolveCredential:capabilities.resolveCredential,resolvePricing:capabilities.resolvePricing,runtimeMode:capabilities.runtimeMode,providerSimulation:capabilities.providerSimulation,providerGuard:capabilities.providerGuard,allowSynthetic:capabilities.allowSynthetic});
 const memory=bindCampaignMemory(store,{workRoot:resources.root,memoryWorker:capabilities.memoryWorker,memoryRuntime:capabilities.memoryRuntime});if(capabilities.memoryWorker)memory.name='Injected scoped memory worker';
 const childResources=new ChildResources(resources);await childResources.store.serial(()=>childResources.recover());const agentWorkspace=new AgentWorkspace(store,{resources:childResources,memoryFactory:(scoped,options)=>memory.fork(scoped,{scopePolicy:options.scopePolicy,authority:options.authority,pinned:true}),memoryWorker:capabilities.memoryWorker,worker:capabilities.agentWorker||createModelChildWorker(transport)});await agentWorkspace.recover();
 const engine=new CampaignEngine(store,{sandbox,transport,memory,resources,assistantResources,agentWorkspace,fault}),authoring=new AuthoringWorkspace(store,{leases:engine.leases});engine.authoring=authoring;
 return {store,sandbox,resources,assistantResources,authoring,childResources,agentWorkspace,providerCatalog:new ProviderCatalog({fetcher:capabilities.catalogFetch,accountScope:capabilities.catalogAccountScope}),engine,example};
}
