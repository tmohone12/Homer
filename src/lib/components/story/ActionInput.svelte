<script lang="ts">
 import {onMount,untrack} from 'svelte';
 import {buildActionContent,decodeActionDraft,encodeActionDraft,turnActionTypeForInput,type ActionType} from './actionInput';
 interface Props {connected?:boolean;deliveryPending?:boolean;recoveredAction?:any;sessionId?:string;campaignId?:string;thirdPerson?:boolean;protagonistName?:string;run?:any;busy?:boolean;onturn?:(action:{text:string;actionType:string})=>Promise<void>;onstop?:()=>Promise<void>;onresume?:()=>Promise<void>;questionPending?:boolean;}
 let {connected=true,deliveryPending=false,recoveredAction=null,sessionId='browser_default',campaignId='synthetic',thirdPerson=false,protagonistName='Player',run=null,busy=false,onturn,onstop,onresume,questionPending=false}:Props=$props();
 let text=$state(''),mode=$state<ActionType>('do'),error=$state(''),submitting=$state(false);
 const legacyDraftKey='mythengine:overhaul:'+campaignId+':action-draft',draftKey='mythengine:overhaul:'+sessionId+':'+campaignId+':action-draft';
 onMount(()=>{try{const draft=decodeActionDraft(localStorage.getItem(draftKey)??localStorage.getItem(legacyDraftKey));text=draft.text;mode=draft.actionType;acceptRecovered(recoveredAction);}catch{error='Draft storage is unavailable on this device. Keep a copy before leaving.';}});
 function acceptRecovered(recovered:any){if(recovered&&recovered.text===buildActionContent(text.trim(),mode,{thirdPerson,protagonistName})&&recovered.actionType===turnActionTypeForInput(text,mode)){text='';persist();}}
 $effect(()=>{const recovered=recoveredAction;untrack(()=>acceptRecovered(recovered));});
 function persist(){try{localStorage.setItem(draftKey,encodeActionDraft({text,actionType:mode}));}catch{error='Draft could not be saved on this device. Keep a copy before leaving.';}}
 async function submit(){if(!connected||deliveryPending||!text.trim()||submitting||busy||run?.status==='running'||questionPending)return;error='';submitting=true;const submitted=text;try{await onturn?.({text:buildActionContent(submitted.trim(),mode,{thirdPerson,protagonistName}),actionType:turnActionTypeForInput(submitted,mode)});if(text===submitted){text='';persist();}}catch(e:any){error=e.message;}finally{submitting=false;}}
</script>
<section class="composer" aria-label="Story action composer">
 <h2>Your next move</h2>
 <div class="modes" aria-label="Action mode">{#each [['do','Do'],['say','Say'],['think','Think'],['story','Story'],['pov','POV'],['free','Free']] as [value,label]}<button class:active={mode===value} aria-pressed={mode===value} disabled={busy||submitting||run?.status==='running'} onclick={()=>{mode=value as ActionType;persist();}}>{label}</button>{/each}</div>
 <label for="story-action">Your action</label><textarea id="story-action" bind:value={text} oninput={persist} rows="2" maxlength="2000" enterkeyhint="enter" placeholder="Write an action, speak in character, or guide the scene..." onkeydown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void submit();}}}></textarea>
 <div class="controls"><button class="primary" disabled={!connected||deliveryPending||busy||submitting||!text.trim()||run?.status==='running'||questionPending} onclick={submit}>Continue story</button>{#if run?.status==='running'}<button onclick={onstop}>Stop</button>{:else if run?.status==='paused'&&!run?.pendingQuestion}<button onclick={onresume}>Resume</button>{/if}<small>Ctrl+Enter to continue</small></div>
 {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>
 .composer{margin:0;padding:0}.modes,.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.modes{margin:7px 0}button{color:#bec2b6;background:#192219;border:1px solid #354035;border-radius:6px;padding:8px 13px;cursor:pointer}button.active,.primary{color:#f0e3c7;border-color:#b3955c;background:#364330}button:disabled{opacity:.5;cursor:default}h2{font:12px Georgia,serif;color:#bbbfae;margin:0 0 5px}label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}textarea{width:100%;box-sizing:border-box;color:#eeece4;background:#101510;border:1px solid #354035;border-radius:6px;padding:11px;font:14px/1.5 Georgia,serif;resize:vertical;min-height:64px;max-height:140px}.controls{margin-top:10px}small{margin-left:auto;color:#92998a;font-size:11px}p{color:#ecbec8}

 @media(max-width:1099px){h2{display:none}.modes{gap:4px;flex-wrap:nowrap;margin:0 0 6px}.modes button{flex:1;min-width:0;min-height:44px;padding:6px 4px;font-size:12px}.controls{margin-top:6px;gap:6px}.controls button{min-height:44px}.controls small{display:none}textarea{font-size:16px;min-height:54px;max-height:min(140px,calc(var(--homer-viewport-height,100dvh)*.28));padding:8px 10px;resize:none}.primary{flex:1}p{font-size:12px;margin:6px 0 0}}
 @media(max-height:520px) and (max-width:1099px){.modes button{min-height:44px}.modes{margin-bottom:4px}textarea{min-height:44px;height:48px}.controls{margin-top:4px}}

</style>