<script>
 let {api,guarded,busy=false,people=[],profiles=[]}=$props();
 let definitions=$state([]),agents=$state([]),tasks=$state([]),template=$state(''),childId=$state(''),document=$state(''),expectedHash=$state(null),label=$state(''),role=$state('gm'),actorId=$state(''),readIds=$state(''),restricted=$state(false),delegatable=$state(false),proposeCanon=$state(false),enabled=$state(true),input=$state(''),report=$state('');
 const operation=prefix=>prefix+'_'+crypto.randomUUID().replaceAll('-','');
 const command=(intent,payload)=>api({intent:'agents',command:{intent,payload}});
 async function load(){const resources=await api({intent:'childResources',command:{intent:'list'}}),workspace=await command('list');definitions=resources.definitions;template=resources.template;agents=workspace.agents;tasks=workspace.tasks;if(!document)document=template;}
 function choose(id){const definition=definitions.find(d=>d.childId===id),config=agents.find(a=>a.config.id===id)?.config;childId=id;document=definition?.document||template.replace('id: task','id: '+id);expectedHash=definition?.hash||null;label=config?.label||definition?.config.name||id;role=config?.scope.role||'gm';actorId=config?.scope.actorId||'';restricted=config?.readIds!==undefined;readIds=(config?.readIds||[]).join('\n');delegatable=config?.delegatable||false;proposeCanon=config?.proposeCanon||false;enabled=config?.enabled??true;}
 async function saveDefinition(){await api({intent:'childResources',command:{intent:'save',payload:{operationId:operation('definition'),childId,expectedHash,document}}});await load();choose(childId);report='Definition saved. Existing tasks retain their pinned revision.';}
 async function bind(){await command('configure',{id:childId,label:label||childId,resourceId:childId,scope:role==='npc'?{role,actorId}:{role},...(restricted?{readIds:readIds.split('\n').map(s=>s.trim()).filter(Boolean)}:{}),delegatable,proposeCanon:role==='gm'&&proposeCanon,enabled});await load();report='Campaign identity saved. Changed scopes require a new task.';}
 async function submit(){const sessionId=operation('session'),taskId=operation('task');await command('session',{id:sessionId,participants:[childId]});await command('submit',{id:taskId,sessionId,agentId:childId,input});await load();report='Task queued. Execute it to use the selected adapter.';}
 function launch(task){report='Child is executing; cancel remains available.';void command('execute',{taskId:task.taskId}).then(result=>{report=JSON.stringify(result,null,2);return load();}).catch(error=>{report=error.message;});setTimeout(()=>void load().catch(error=>report=error.message),300);}
 async function act(intent,task){const result=await command(intent,intent==='approve'?{taskId:task.taskId,proposalHash:task.proposalHash,approvalId:operation('approval')}:{taskId:task.taskId});report=JSON.stringify(result,null,2);await load();}
 $effect(()=>{void guarded(load);});
</script>
<section aria-label="Child agents">
 <h2>Configured child agents</h2><p>Create task helpers as needed. No roster or schedule runs automatically. NPC tasks use only their authorized sources; intentions do not establish outcomes.</p>
 <button onclick={()=>guarded(load)}>Refresh agents and tasks</button>
 <label>Definition<select id="child-definition" onchange={event=>choose(event.target.value)}><option value="">New definition</option>{#each definitions as definition}<option value={definition.childId}>{definition.config.name}</option>{/each}</select></label>
 <label>Stable child ID<input id="child-id" bind:value={childId} oninput={()=>{expectedHash=null;document=template.replace('id: task','id: '+childId);}}/></label>
 <label>Markdown definition and YAML permissions<textarea id="child-document" rows="18" bind:value={document}></textarea></label>
 <p>Set modelProfileId to null for the saved assistant selection, or use a saved profile ID: {profiles.map(p=>p.id).join(', ')}. Tools are read, grep and recall; request, tool, token and timeout limits are enforced.</p>
 <button disabled={busy||!childId} onclick={()=>guarded(saveDefinition)}>Save child definition</button>
 <h3>Campaign scope</h3><label>Label<input id="child-label" bind:value={label}/></label><label>Authority<select id="child-role" bind:value={role}><option value="gm">GM scoped helper</option><option value="npc">NPC knowledge only</option></select></label>
 {#if role==='npc'}<label>NPC<select id="child-actor" bind:value={actorId}><option value="">Choose NPC</option>{#each people as person}<option value={person.id}>{person.name}</option>{/each}</select></label>{/if}
 <label><input id="child-restricted" type="checkbox" bind:checked={restricted}/>Limit reads to these IDs</label>{#if restricted}<label>Record IDs, one per line<textarea id="child-read-ids" bind:value={readIds}></textarea></label>{/if}
 <label><input id="child-enabled" type="checkbox" bind:checked={enabled}/>Enabled</label><label><input id="child-delegatable" type="checkbox" bind:checked={delegatable}/>Allow GM delegation</label>{#if role==='gm'}<label><input id="child-canon" type="checkbox" bind:checked={proposeCanon}/>Allow separate authoring proposals for exact review</label>{/if}
 <button disabled={busy||!definitions.some(d=>d.childId===childId)} onclick={()=>guarded(bind)}>Save campaign agent</button>
 <h3>Tasks</h3><label>Task request<textarea id="child-task-input" bind:value={input}></textarea></label><button disabled={busy||!input.trim()||!agents.some(a=>a.config.id===childId)} onclick={()=>guarded(submit)}>Queue task</button>
 {#each tasks as task}<article><strong>{task.agentId} · {task.taskId}</strong><p>{task.status} · revision {task.resourceSnapshot?.revision?.slice(0,12)||'manual'}</p>
 {#if task.status==='queued'}<button disabled={busy} onclick={()=>launch(task)}>Execute task</button>{/if}
 {#if !['completed','cancelled','failed','conflicted'].includes(task.status)}<button onclick={()=>guarded(()=>act('cancel',task))}>Cancel task</button>{/if}
 {#if task.proposal}<pre>{JSON.stringify(task.proposal,null,2)}</pre>{/if}
 {#if task.status==='proposed'&&task.proposal?.kind==='canonical'&&!task.parentRunId}<button disabled={busy} onclick={()=>guarded(()=>act('approve',task))}>Approve this exact proposal</button>{/if}
 {#if task.status==='approved'}<button disabled={busy} onclick={()=>guarded(()=>act('commit',task))}>Commit approved proposal</button>{/if}
 {#if task.parentRunId}<p>Gameplay task: supported effects publish through completed GM narration automatically. This proposal is not an author approval queue.</p>{/if}
 {#if task.error}<p>{task.error.code}: {task.error.message}</p>{/if}</article>{/each}
 <pre aria-live="polite">{report}</pre>
</section>
<style>label{display:block;margin:12px 0}label>input:not([type=checkbox]),select,textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px}button,input,select,textarea{background:#182219;color:#e7d9bb;border:1px solid #3d4937;border-radius:5px;padding:8px;font:inherit}button{cursor:pointer;min-height:44px;margin:4px}textarea{font:14px monospace}article{border-top:1px solid #354035;padding:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:380px;overflow:auto}p{line-height:1.6}@media(max-width:1099px){input,select,textarea{font-size:16px}}</style>
