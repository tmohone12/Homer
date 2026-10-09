<script>
 import {untrack} from 'svelte';
 let {record,sourceHash='',records=[],busy=false,onsave}= $props();
 let ruler=$state(''),controller=$state(''),worldTime=$state(''),mode=$state('occupation'),sourceIds=$state('');
 let owner=$state(''),accessHouse=$state(''),accessKind=$state('permission'),accessScope=$state('');
 let claimText=$state(''),claimKind=$state('learned'),claimMethod=$state('read'),claimSource=$state(''),claimFrom=$state(''),claimReason=$state(''),claimConfidence=$state(0.7);
 let politicalHouse=$state(''),politicalBasis=$state(''),politicalStatus=$state('disputed');
 const houses=$derived(records.filter(r=>r.type==='house')),actors=$derived(records.filter(r=>r.type==='character'));
 const actorEvents=$derived(records.filter(r=>r.type==='event'&&r.data.knownBy.includes(record.id)));
 const label=id=>records.find(r=>r.id===id)?.name||id;
 const newId=prefix=>prefix+'_'+crypto.randomUUID().replaceAll('-','');
 const evidence=()=>sourceIds.split(',').map(s=>s.trim()).filter(Boolean);
 let baseline=$state(null),baselineHash=$state('');
 const recordId=$derived(record.id);
 const sourceChanged=$derived(!!baseline&&sourceHash!==baselineHash);
 function reload(){baseline=structuredClone($state.snapshot(record));baselineHash=sourceHash;ruler=record.data.politics?.rulingHouseId||'';controller=record.data.politics?.controllerHouseId||record.data.controllerHouseId||'';owner=record.data.ownerHouseId||'';worldTime='';sourceIds='';claimText='';claimSource='';claimFrom='';claimReason='';accessScope='';politicalBasis='';politicalHouse='';accessHouse='';}
 $effect(()=>{recordId;untrack(reload);});
 const formState=()=>JSON.stringify([ruler,controller,owner,worldTime,mode,sourceIds,claimText,claimKind,claimMethod,claimSource,claimFrom,claimReason,claimConfidence,accessHouse,accessKind,accessScope,politicalHouse,politicalBasis,politicalStatus]);
 async function save(patch){const editingId=recordId,before=formState(),receipt=await onsave(patch,baselineHash);if(receipt?.status==='applied'&&recordId===editingId&&sourceHash===receipt.afterHash&&formState()===before)reload();}

 async function saveControl(){const history=(baseline.data.politics.controlHistory||[]).map(row=>row.until===null?{...row,until:worldTime}:row);history.push({id:newId('control'),controllerHouseId:controller||null,recognizedRulerHouseId:ruler||null,mode,from:worldTime,until:null,evidenceIds:evidence(),knownBy:[],visibility:'public'});await save({'data.politics.rulingHouseId':ruler||null,'data.politics.controllerHouseId':controller||null,'data.politics.controlHistory':history});}
 async function addPoliticalClaim(){const claim={id:newId('claim'),houseId:politicalHouse,basis:politicalBasis,status:politicalStatus,from:worldTime||null,until:null,evidenceIds:evidence(),knownBy:[],visibility:'public'};await save({'data.politics.claims':[...baseline.data.politics.claims,claim]});}
 async function saveResourceControl(){await save({'data.ownerHouseId':owner||null,'data.controllerHouseId':controller||null});}
 async function grantAccess(){const right={id:newId('access'),houseId:accessHouse,kind:accessKind,scope:accessScope,from:worldTime,until:null,evidenceIds:evidence(),knownBy:[],visibility:'public'};await save({'data.accessHouseIds':[...new Set([...baseline.data.accessHouseIds,accessHouse])],'data.accessRights':[...baseline.data.accessRights||[],right]});}
 async function revokeAccess(id){const rights=baseline.data.accessRights.map(right=>right.id===id?{...right,until:worldTime}:right),active=new Set(rights.filter(r=>r.until===null).map(r=>r.houseId));await save({'data.accessRights':rights,'data.accessHouseIds':baseline.data.accessHouseIds.filter(h=>active.has(h))});}
 async function addKnowledge(){const source=claimSource?[claimSource]:[],visibility='secret',confidence=Number(claimConfidence),actorId=record.id;
  const claim={id:newId('knowledge'),text:claimText,kind:claimKind,knownBy:[actorId],evidenceIds:source,confidence,visibility,acquisitions:claimKind==='belief'?[]:[{actorId,method:claimKind==='witnessed'?'witnessed':claimMethod,fromActorId:claimFrom||null,worldTime:worldTime||null,evidenceIds:source,confidence,visibility}],beliefProvenance:claimKind==='belief'?[{actorId,basisEvidenceIds:source,sourceActorId:claimFrom||null,worldTime:worldTime||null,reason:claimReason,assessment:'unverified',confidence,visibility}]:[]};await save({'data.knowledge':[...baseline.data.knowledge,claim]});
 }
</script>
{#if ['location','resource','character'].includes(record.type)}
<details class="domain-editor"><summary>{record.type==='location'?'Record political control / claims':record.type==='resource'?'Record ownership / access':'Record personal knowledge / belief'}</summary>
 {#if sourceChanged}<p role="status">This file changed while you were editing. Your fields are retained; reload before saving.</p><button onclick={reload}>Reload domain form</button>{/if}
 <label for="domain-world-time">In-world time</label><input id="domain-world-time" bind:value={worldTime} placeholder="Day 2, morning"/>
 {#if record.type!=='character'}<label for="domain-evidence">Accepted source event IDs, if any</label><input id="domain-evidence" bind:value={sourceIds}/>{/if}
 {#if record.type==='location'}
 <label for="political-ruler">Recognized ruler</label><select id="political-ruler" bind:value={ruler}><option value="">None / independent</option>{#each houses as house}<option value={house.id}>{house.name}</option>{/each}</select>
 <label for="political-controller">Actual controller</label><select id="political-controller" bind:value={controller}><option value="">None / independent</option>{#each houses as house}<option value={house.id}>{house.name}</option>{/each}</select>
 <label for="political-mode">How control changed</label><select id="political-mode" bind:value={mode}>{#each ['occupation','stewardship','inheritance','treaty','independence','unspecified'] as item}<option value={item}>{item}</option>{/each}</select><p>Records this place's history. Its region and neighboring towns or castles keep their own control.</p><button disabled={busy||sourceChanged||!worldTime.trim()} onclick={saveControl}>Save local control</button>
 <label for="political-claim-house">Claiming House</label><select id="political-claim-house" bind:value={politicalHouse}><option value="">Choose House</option>{#each houses as house}<option value={house.id}>{house.name}</option>{/each}</select><label for="political-claim-basis">Claim basis</label><textarea id="political-claim-basis" bind:value={politicalBasis} rows="2"></textarea><label for="political-claim-status">Claim status</label><select id="political-claim-status" bind:value={politicalStatus}>{#each ['asserted','recognized','disputed','withdrawn'] as status}<option value={status}>{status}</option>{/each}</select><button disabled={busy||sourceChanged||!politicalHouse||!politicalBasis.trim()} onclick={addPoliticalClaim}>Add political claim</button>
 {:else if record.type==='resource'}
 <label for="resource-owner">Legal owner</label><select id="resource-owner" bind:value={owner}><option value="">None</option>{#each houses as house}<option value={house.id}>{house.name}</option>{/each}</select><label for="resource-controller">Actual controller</label><select id="resource-controller" bind:value={controller}><option value="">None</option>{#each houses as house}<option value={house.id}>{house.name}</option>{/each}</select><button disabled={busy||sourceChanged} onclick={saveResourceControl}>Save ownership / controller</button>
 <label for="access-house">House receiving access</label><select id="access-house" bind:value={accessHouse}><option value="">Choose House</option>{#each houses as house}<option value={house.id}>{house.name}</option>{/each}</select><label for="access-kind">Basis of access</label><select id="access-kind" bind:value={accessKind}>{#each ['permission','treaty','lease','custom','seizure','unspecified'] as kind}<option value={kind}>{kind}</option>{/each}</select><label for="access-scope">Access terms / limits</label><textarea id="access-scope" bind:value={accessScope} rows="2"></textarea><button disabled={busy||sourceChanged||!worldTime.trim()||!accessHouse||!accessScope.trim()} onclick={grantAccess}>Grant limited access</button>
 {#each record.data.accessRights||[] as right}{#if right.until===null}<p>{label(right.houseId)}: {right.scope}</p><button aria-label={'End access '+right.id} disabled={busy||sourceChanged||!worldTime.trim()} onclick={()=>revokeAccess(right.id)}>End this access right</button>{/if}{/each}
 {:else}
 <p>Only {record.name}'s personal knowledge changes. A belief remains an interpretation, never established truth.</p>
 <label for="knowledge-text">Claim</label><textarea id="knowledge-text" bind:value={claimText} rows="2"></textarea><label for="knowledge-kind">Knowledge kind</label><select id="knowledge-kind" bind:value={claimKind}><option value="learned">Learned</option><option value="witnessed">Witnessed</option><option value="belief">Belief</option></select>
 {#if claimKind==='learned'}<label for="knowledge-method">How it was learned</label><select id="knowledge-method" bind:value={claimMethod}>{#each ['read','told','inferred','unspecified'] as method}<option value={method}>{method}</option>{/each}</select>{/if}
 <label for="knowledge-source">Personally known source event</label><select id="knowledge-source" bind:value={claimSource}><option value="">No source / unsupported belief</option>{#each actorEvents as event}<option value={event.id}>{event.name}</option>{/each}</select>
 <label for="knowledge-from">Source character, if known</label><select id="knowledge-from" bind:value={claimFrom}><option value="">Unrecorded</option>{#each actors.filter(actor=>actor.id!==record.id) as actor}<option value={actor.id}>{actor.name}</option>{/each}</select>
 <label for="knowledge-confidence">Confidence (0–1)</label><input id="knowledge-confidence" type="number" min="0" max="1" step="0.05" bind:value={claimConfidence}/>
 {#if claimKind==='belief'}<label for="belief-reason">Why this character believes it</label><textarea id="belief-reason" bind:value={claimReason} rows="2"></textarea>{/if}
 <button disabled={busy||sourceChanged||!claimText.trim()||(claimKind!=='belief'&&!claimSource)||(claimKind==='belief'&&!claimReason.trim())} onclick={addKnowledge}>Save personal claim</button>
 {/if}
</details>
{/if}
<style>
.domain-editor{border:1px solid #354035;border-radius:8px;padding:7px 12px;margin:12px 0;font-size:12px}summary{cursor:pointer;color:#bec2b6;padding:5px 0}label{display:block;color:#bec2b6;font-size:11px;margin:12px 0 5px}input,select,textarea{box-sizing:border-box;width:100%;font:inherit;background:#101510;color:#eeece4;border:1px solid #354035;border-radius:5px;padding:7px}p{font-size:11px;color:#92998a;margin:9px 0}button{font:inherit;background:#20271f;color:#dcded3;border:1px solid #354035;border-radius:5px;padding:6px 8px;margin-top:9px;cursor:pointer}button:hover{border-color:#b79860}button:disabled{opacity:.4;cursor:default}
</style>
