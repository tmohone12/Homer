<script>
 import {untrack} from 'svelte';
 let {record,sourceHash='',busy=false,onsave}=$props();
 let saving=$state(false),baselineHash=$state(''),affiliations=$state('[]'),deviations=$state('[]'),aliases=$state('[]'),shared=$state('{}'),error=$state('');
 const recordId=$derived(record.id),changed=$derived(baselineHash!==sourceHash);
 function reload(){baselineHash=sourceHash;affiliations=JSON.stringify(record.data.cultures||[],null,2);deviations=JSON.stringify(record.data.cultureDeviations||[],null,2);aliases=JSON.stringify(record.data.aliases||[],null,2);shared=JSON.stringify(record.data,null,2);error='';}
 $effect(()=>{recordId;untrack(reload);});
 async function save(){saving=true;error='';try{const patch=record.type==='culture'?Object.fromEntries(Object.entries(JSON.parse(shared)).map(([key,value])=>['data.'+key,value])):{'data.cultures':JSON.parse(affiliations),'data.cultureDeviations':JSON.parse(deviations),'data.aliases':JSON.parse(aliases)};const receipt=await onsave(patch,baselineHash);if(['applied','unchanged'].includes(receipt?.status))reload();}catch(e){error=e.message;}finally{saving=false;}}
</script>
{#if ['character','culture'].includes(record.type)}
<details class="culture-editor"><summary>{record.type==='culture'?'Edit shared culture norms and contextual cues':'Edit cultural affiliations and personal deviations'}</summary>
 <p>Shared cultures own norms. Characters keep links and individual differences. Visibility and explicit knownBy grants are both required for an NPC; knowing a custom does not require following it.</p>
 {#if changed}<p role="status">The source changed. Your draft is retained; reload before saving.</p><button onclick={reload}>Reload culture fields</button>{/if}
 {#if record.type==='culture'}<label for="culture-shared">Shared culture fields</label><textarea id="culture-shared" rows="20" bind:value={shared}></textarea>
 {:else}<label for="culture-affiliations">Affiliations: culture_ref, optional variant_ref, relation, familiarity, identification, visibility, knownBy</label><textarea id="culture-affiliations" rows="10" bind:value={affiliations}></textarea><label for="culture-deviations">Personal deviations: defining culture_ref, cue_ref, text, visibility, knownBy</label><textarea id="culture-deviations" rows="8" bind:value={deviations}></textarea><label for="culture-aliases">Optional aliases: stable id, text, visibility, knownBy</label><textarea id="culture-aliases" rows="6" bind:value={aliases}></textarea>{/if}
 <p>These structured fields are saved in the character or culture Markdown file. Background, goals, ancestry, relationships, knowledge and player mechanics retain their existing sections. Culture text describes tendencies and exceptions; it never directs a model to manufacture behavior.</p>
 <button id="culture-save" disabled={busy||saving||changed} onclick={save}>Save culture fields</button>{#if error}<p role="alert">{error}</p>{/if}
</details>
{/if}
<style>.culture-editor{border:1px solid #46533e;border-radius:8px;padding:12px;margin:16px 0}summary{cursor:pointer;min-height:36px}p,label{font-size:13px;line-height:1.5}label{display:block;margin:14px 0 6px}textarea{width:100%;box-sizing:border-box;padding:10px;background:#182219;color:#e7d9bb;border:1px solid #46533e;border-radius:5px;font:14px monospace}button{min-height:44px;padding:10px;background:#364330;color:#eee3c9;border:1px solid #b89d65;border-radius:6px}button:disabled{opacity:.5}@media(max-width:650px){textarea{font-size:16px}}</style>
