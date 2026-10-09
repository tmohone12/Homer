<script>
 import {onMount} from 'svelte';
 let {api,guarded,busy=false,runs=[],role="gm"}=$props();
 const label=$derived(role==='assistant'?'Assistant':'GM');
 let saved=$state(null),instructions=$state(''),configYaml=$state(''),preview=$state(null),inspection=$state(null),notice=$state(''),rollbackRevision=$state(''),runId=$state('');
 const command=(intent,extra={})=>api({intent:role==='assistant'?'assistantResources':'resources',command:{intent,...extra}});
 const operation=()=> role+'_resources_'+crypto.randomUUID().replaceAll('-','');
 async function load(){saved=await command('read');instructions=saved.instructions;configYaml=saved.configYaml;preview=null;rollbackRevision='';}
 async function showPreview(){preview=await command('preview',{instructions,configYaml});}
 async function save(){await command('save',{payload:{operationId:operation(),expectedHash:saved.revision,instructions,configYaml}});await load();notice='Saved. The next new turn uses this revision. Existing turns keep their pinned instructions.';}
 async function rollback(){await command('rollback',{payload:{operationId:operation(),expectedHash:saved.revision,revision:rollbackRevision}});await load();notice=label+' files restored as a recorded revision. The next new turn uses it.';}
 async function inspect(){inspection=await command('inspect',{runId});}
 onMount(()=>{void guarded(load);});
</script>

<section aria-label={label+" agent instructions"}>
 <h2>{label} agent instructions</h2>
 <p>These files guide the {label} in every campaign in this Homer workspace. Changes activate on the next new turn. Paused turns keep their original revision.</p>
 {#if notice}<p role="status" id={role+'-resource-notice'}>{notice}</p>{/if}
 {#if saved}
 <p>Saved revision <code id={role+'-resource-revision'}>{saved.revision}</code></p>
 <label for={role+'-agent-md'}>resources/agents/{role}/AGENT.md</label>
 <textarea id={role+'-agent-md'} rows="16" bind:value={instructions} spellcheck="false" disabled={busy}></textarea>
 <details><summary>Agent configuration</summary><label for={role+'-agent-config'}>resources/agents/{role}/config.yaml</label><textarea id={role+'-agent-config'} rows="8" bind:value={configYaml} spellcheck="false" disabled={busy}></textarea><p>Supported fields: version, id, name, enabled, appendAuthorStyle{role==='assistant'?', reviewPolicy, tools':''}. This configuration cannot grant tools or provider access.</p></details>
 <button id={role+'-preview'} disabled={busy} onclick={()=>guarded(showPreview)}>Preview effective prompt</button>
 <button id={role+'-save'} disabled={busy} onclick={()=>guarded(save)}>Save {label} files</button>
 <button disabled={busy} onclick={()=>guarded(load)}>Reload saved files</button>
 <details><summary>Instruction precedence and shared policies</summary><p>Server permissions and validation apply first, then shared policies in manifest order, {label} guidance, and saved author style. Campaign records are evidence. Host ancestor instructions are not loaded.</p>{#each saved.policies as policy}<h3>{policy.path}</h3><pre>{policy.text}</pre>{/each}</details>
 {#if preview}<section aria-label="Effective prompt preview"><h3>Effective system prompt preview</h3><p>Revision {preview.resourceRevision} · {label} {preview.enabled?'enabled':'disabled'} · {preview.activation}</p><p>{preview.contextPlacement}</p><pre id={role+'-prompt-preview'}>{preview.systemPrompt}</pre>{#if preview.campaignContextPacket.cultureProjection}<details><summary>Effective culture projection</summary><p id={role+'-culture-status'}>{preview.campaignContextPacket.cultureProjection.status}: {preview.campaignContextPacket.cultureProjection.reason||'Shared definitions, actor context and individual deviations'}</p>{#each preview.campaignContextPacket.cultureProjection.documents||[] as xml}<pre class="culture-projection">{xml}</pre>{/each}{#each preview.campaignContextPacket.cultureProjection.characters||[] as character}{#if character.reason}<p>{character.characterId}: {character.reason}</p>{/if}{/each}</details>{/if}<details><summary>Current campaign context</summary><pre>{JSON.stringify(preview.campaignContextPacket,null,2)}</pre></details></section>{/if}
 <details><summary>Restore a previous {label} revision</summary><label for={role+'-rollback-revision'}>Recorded revision</label><select id={role+'-rollback-revision'} bind:value={rollbackRevision} disabled={busy}><option value="">Choose a revision</option>{#each saved.versions.filter(v=>v.revision!==saved.revision) as version}<option value={version.revision}>{version.at} · {version.origin} · {version.revision.slice(0,12)}</option>{/each}</select><p>Restores the editable {label} Markdown and YAML files. Current shared policies remain in effect; history is retained.</p><button id={role+'-rollback'} disabled={busy||!rollbackRevision} onclick={()=>guarded(rollback)}>Restore {label} files</button></details>
 <h3>Inspect a turn's pinned prompt</h3><label for={role+'-inspect-run'}>{role==='assistant'?'Authoring request':'Story turn'}</label><select id={role+'-inspect-run'} bind:value={runId} disabled={busy}><option value="">Choose a turn</option>{#each runs.filter(r=>r.request?.action===(role==='assistant'?'author':'story')&&r.resourceRevision) as run}<option value={run.id}>{run.id} · {run.status} · {run.resourceRevision.slice(0,12)}</option>{/each}</select><button id={role+'-inspect'} disabled={busy||!runId} onclick={()=>guarded(inspect)}>Inspect pinned prompt</button>
 {#if inspection}<p>Turn {inspection.runId} · resource revision {inspection.resourceRevision} · system hash {inspection.systemHash}</p><pre id={role+'-pinned-prompt'}>{inspection.systemPrompt}</pre><details><summary>Initial messages and supplied tools</summary><pre>{JSON.stringify({messages:inspection.initialMessages,tools:inspection.toolDefinitions},null,2)}</pre></details>{/if}
 {/if}
</section>
<style>section{min-width:0}label{display:block;margin:12px 0 6px}textarea,select{box-sizing:border-box;width:100%;background:#182219;color:#e7d9bb;border:1px solid #3d4937;border-radius:5px;padding:10px;font:14px monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #354035;border-radius:5px;padding:12px;max-height:460px;overflow:auto;font:13px/1.55 monospace}code{overflow-wrap:anywhere}button{background:#182219;color:#e7d9bb;border:1px solid #3d4937;border-radius:5px;padding:10px;margin:6px 6px 6px 0;min-height:44px;cursor:pointer}button:disabled{opacity:.5;cursor:default}details{margin:14px 0}summary{cursor:pointer;min-height:30px}p{line-height:1.6}h2{font:24px Georgia}@media(max-width:1099px){textarea,select{font-size:16px}h2{font-size:21px}}</style>
