<script>
 import {onMount} from 'svelte';
 let {api,guarded,refresh,state:world,campaignId,onopen,busy=false}=$props();
 let draftReady=$state(false),request=$state(''),run=$state(null),proposal=$state(null),files=$state(null),source=$state(null),type=$state(''),offset=$state(0),startLine=$state(1),answer=$state(''),playerAck=$state(false),notice=$state('');
 const command=(intent,payload)=>api({intent:'authoring',command:{intent,...(payload?{payload}:{})}});
 const operation=prefix=>prefix+'_'+crypto.randomUUID().replaceAll('-','');
 const draftKey=()=> 'homer:author-draft:'+campaignId;
 $effect(()=>{if(draftReady&&typeof sessionStorage!=='undefined')sessionStorage.setItem(draftKey(),request);});
 const pending=$derived(run?.status==='running'||run?.status==='paused');
 async function navigate(next=0){offset=next;files=await command('navigate',{...(type?{type}:{}),offset,limit:30});}
 async function read(id,line=1){source=await command('range',{id,startLine:line});startLine=source.startLine;}
 async function readProposal(){const values=await command('list');proposal=values.find(p=>p.runId===run?.id)||null;}
 async function loadRun(id){run=id?await api({intent:'run',id}):null;playerAck=false;await readProposal();}
 async function reload(){await refresh();await navigate(offset);await loadRun(run?.id||world.authorRuns?.[0]?.id);}
 async function submit(){notice='';const id=operation('author');run=await api({intent:'turn',turn:{id,action:'author',text:request}});proposal=null;playerAck=false;await refresh();await readProposal();}
 async function stop(){run=await api({intent:'stop',id:run.id});await readProposal();await refresh();}
 async function answerQuestion(choice){run=await api({intent:'answer',id:run.id,choice});answer='';await refresh();}
 async function dismiss(){run=await api({intent:'dismiss',id:run.id});await readProposal();await refresh();}
 async function review(action){notice='';if(action==='approve')proposal=await command(action,{runId:run.id,proposalHash:proposal.proposalHash,approvalId:operation('author_approval'),acknowledgePlayerHistory:playerAck});else if(action==='undo')proposal=await command(action,{runId:run.id,operationId:operation('author_undo')});else proposal=await command(action,{runId:run.id});notice='Proposal '+proposal.status+'.';await refresh();await navigate(offset);if(source){const present=world.records.some(r=>r.id===source.id);source=present?await command('range',{id:source.id,startLine:1}):null;}}
 let polling=false,disposed=false;
 async function poll(){if(polling||disposed||!run||run.status!=='running')return;polling=true;try{const next=await api({intent:'run',id:run.id});if(disposed)return;run=next;await readProposal();if(run.status!=='running'){await refresh();await navigate(offset);}}catch(error){if(error.code!=='STALE_VIEW')notice=error.message;}finally{polling=false;}}
 onMount(()=>{request=sessionStorage.getItem(draftKey())||'';draftReady=true;void guarded(reload);const timer=setInterval(poll,800);return()=>{disposed=true;clearInterval(timer);};});
</script>

<section aria-label="Authoring agent">
 <div class="eyebrow">Authoring assistant</div><h1>Build your world</h1>
 <p>The Assistant can explore files, ask questions, and prepare validated changes. Its saved agent files, selected model, scoped children, budgets, and progress use the shared runtime. Review the exact patch before publishing it.</p>
 <label for="author-request">Authoring request</label><textarea id="author-request" rows="4" bind:value={request} placeholder="Create a House named House Lantern" disabled={busy||pending}></textarea>
 <button id="author-submit" disabled={busy||pending||!request.trim()} onclick={()=>guarded(submit)}>Ask authoring agent</button>
 {#if run?.status==='running'||run?.status==='paused'}<button id="author-stop" disabled={busy} onclick={()=>guarded(stop)}>Stop authoring request</button>{/if}
 {#if run?.status==='paused'&&!run?.pendingQuestion}<button id="author-resume" disabled={busy} onclick={()=>guarded(async()=>run=await api({intent:'turn',turn:run.request}))}>Resume saved request</button>{/if}
 <button id="author-reload" disabled={busy} onclick={()=>guarded(reload)}>Reload saved progress</button>
 {#if notice}<p id="author-notice" role="status">{notice}</p>{/if}
 {#if world.authorRuns?.length}<label for="author-run-select">Saved authoring request</label><select id="author-run-select" value={run?.id||''} disabled={busy} onchange={e=>guarded(()=>loadRun(e.currentTarget.value))}><option value="">Choose request</option>{#each world.authorRuns as item}<option value={item.id}>{item.id} · {item.status}</option>{/each}</select>{/if}
 {#if run}
  <p id="author-status">{run.status} · {run.id}</p>{#if run.error}<p role="alert">{run.error.message||run.error}</p>{/if}
  {#if run.pendingQuestion&&!run.pendingQuestion.answer&&!run.pendingQuestion.cancelled}<section aria-label="Author question"><h2>{run.pendingQuestion.text}</h2>{#each run.pendingQuestion.options as choice}<button disabled={busy} onclick={()=>guarded(()=>answerQuestion(choice))}>{choice}</button>{/each}<label for="author-answer">Your answer</label><input id="author-answer" bind:value={answer}/><button id="author-answer-send" disabled={busy||!answer.trim()} onclick={()=>guarded(()=>answerQuestion(answer))}>Send answer</button><button disabled={busy} onclick={()=>guarded(dismiss)}>Dismiss question</button></section>{/if}
  {#if run.text}<article id="author-reply"><p>{run.text}</p></article>{/if}
  <details><summary>Agent progress and task IDs</summary>{#each run.activity||[] as item}<p>{item.name||item.kind} · {item.state} {item.taskId||''}</p>{/each}</details>
 {/if}
 {#if proposal}
  <section aria-label="Authoring patch review"><h2>Review proposed changes</h2><p id="author-proposal-status">{proposal.status} · {proposal.reviewPolicy}</p><p>{proposal.proposal.summary}</p><p>Exact proposal <code id="author-proposal-hash">{proposal.proposalHash}</code></p>
   {#each proposal.preview.changes as change}<details open><summary>{change.path} · {change.id}</summary><h3>Before</h3><pre>{change.before||'(New record)'}</pre><h3>After</h3><pre>{change.after}</pre></details>{/each}
   {#if proposal.playerHistory}<label><input id="author-player-ack" type="checkbox" bind:checked={playerAck}/>I acknowledge this changes the player character record.</label>{/if}
   {#if proposal.status==='proposed'}<button id="author-approve" disabled={busy||pending||proposal.reviewPolicy!=='exact-author-review'||proposal.playerHistory&&!playerAck} onclick={()=>guarded(()=>review('approve'))}>Approve exact patch</button><button id="author-reject" disabled={busy} onclick={()=>guarded(()=>review('reject'))}>Reject proposal</button>{/if}
   {#if ['approved','committing'].includes(proposal.status)}<button id="author-commit" disabled={busy||pending} onclick={()=>guarded(()=>review('commit'))}>Commit approved changes</button>{/if}
   {#if ['proposed','approved','committing'].includes(proposal.status)}<button id="author-cancel" disabled={busy} onclick={()=>guarded(()=>review('cancel'))}>Cancel proposal</button>{/if}
   {#if proposal.status==='committed'}<button id="author-undo" disabled={busy} onclick={()=>guarded(()=>review('undo'))}>Undo this commit</button>{/if}
   <p>Newer source edits invalidate this preview. Undo also checks that its records still match the commit.</p>
  </section>
 {/if}
 <section aria-label="Author file navigation"><h2>World files</h2><label for="author-file-type">Record type</label><select id="author-file-type" bind:value={type} onchange={()=>guarded(()=>navigate(0))}><option value="">All types</option>{#each ['character','house','location','resource','faction','event','chapter'] as kind}<option value={kind}>{kind}</option>{/each}</select>
  {#if files}<p>{files.total} files · {files.offset+1}–{Math.min(files.offset+30,files.total)}</p><div class="file-list">{#each files.files as file}<button onclick={()=>guarded(()=>read(file.id))}><strong>{file.name}</strong><code>{file.path}</code></button>{/each}</div><button disabled={busy||offset===0} onclick={()=>guarded(()=>navigate(Math.max(0,offset-30)))}>Previous files</button><button disabled={busy||files.nextOffset===null} onclick={()=>guarded(()=>navigate(files.nextOffset))}>Next files</button>{/if}
  {#if source}<h3>{source.name}</h3><p>{source.path} · revision {source.revision} · lines {source.startLine}–{source.endLine}/{source.totalLines}</p><code>{source.hash}</code><pre id="author-source-range">{source.text}</pre><label for="author-range-start">Starting line</label><input id="author-range-start" type="number" min="1" max={source.totalLines} bind:value={startLine}/><button disabled={busy} onclick={()=>guarded(()=>read(source.id,Number(startLine)))}>Read bounded range</button><button disabled={busy||source.endLine>=source.totalLines} onclick={()=>guarded(()=>read(source.id,source.endLine+1))}>Next 80 lines</button><button disabled={busy} onclick={()=>guarded(()=>onopen(source.id))}>Open world details</button>{/if}
 </section>
</section>
<style>section{min-width:0;margin:16px 0}h1,h2,h3{font-family:Georgia,serif}p{line-height:1.6}label{display:block;margin:12px 0 6px}textarea,input:not([type=checkbox]),select{box-sizing:border-box;width:100%;padding:10px;background:#182219;color:#e7d9bb;border:1px solid #3d4937;border-radius:5px;font:15px/1.5 monospace}button{min-height:44px;padding:10px;margin:5px;background:#182219;color:#e7d9bb;border:1px solid #3d4937;border-radius:5px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.file-list{display:flex;flex-wrap:wrap}.file-list button{display:flex;flex-direction:column;text-align:left;max-width:100%}code,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap;max-height:400px;overflow:auto;border:1px solid #354035;padding:10px}details{margin:12px 0}summary{cursor:pointer;min-height:32px}@media(max-width:1099px){textarea,input:not([type=checkbox]),select{font-size:16px}}
</style>
