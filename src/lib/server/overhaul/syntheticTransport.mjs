import {buildWorldDraft} from '../../contracts/worldDraft.mjs';
import {hash} from './store.mjs';
/** Deterministic protocol transport only. This is not a model or a replacement for provider-backed roleplay. */
export async function syntheticCampaignGeneration(options){
 await options.onBeforeRequest({serializedBody:JSON.stringify({system:options.system,messages:options.messages,tools:options.tools}),inputTokens:1000,reservedOutputTokens:options.maxTokens,contextWindowTokens:32768});
 if(options.signal?.aborted)throw Error('Synthetic request stopped.');
 await new Promise(resolve=>setTimeout(resolve,90));
 const usage={inputTokens:0,outputTokens:0,totalTokens:0,estimatedCostUsd:0,providerCostUsd:0};
 const respond=async(text,toolCalls)=>{if(text&&typeof options.onTextDelta==='function')for(let at=0;at<text.length;at+=64){if(options.signal?.aborted)throw Error('Synthetic stream stopped.');await options.onTextDelta(text.slice(at,at+64));await new Promise(resolve=>setTimeout(resolve,35));}return {text,toolCalls,model:'synthetic-campaign',endpoint:'disabled:synthetic',finishReason:toolCalls?.length?'tool_calls':'stop',durationMs:0,promptChars:0,responseChars:text.length,usage};};
 if(options.agentRole==='compaction'){const packet=JSON.parse(options.messages[0].content);return respond(JSON.stringify({items:packet.sources.map(source=>({text:'Synthetic extractive fixture: '+source.narration.slice(0,160),sources:[{turnId:source.id,hash:source.hash,quote:source.narration.slice(0,160)||source.action}]}))}));}
 if(options.agentRole==='child'){const packet=JSON.parse(options.messages[0].content);return respond(JSON.stringify({kind:'intention',summary:'Synthetic task fixture: hold pending source review.',value:{sourceIds:packet.sources.map(s=>s.id),mode:'synthetic protocol fixture'}}));}
 if(options.agentRole==='author'){
  const results=new Map((options.messages||[]).filter(m=>m.role==='tool'&&!m.isError).map(m=>[m.toolName,JSON.parse(m.content)])),names=new Set(options.tools?.map(t=>t.name)||[]),question=(options.messages||[]).find(m=>m.role==='user'&&!m.content.startsWith('Current Homer')&&!m.content.startsWith('Historical accepted'))?.content||'',create=question.match(/create a house named (.+)/i),call=(id,name,args)=>respond('',[{id,name,arguments:args}]);
  if(names.has('list_files')&&!results.has('list_files'))return call('author_list','list_files',{limit:40});
  const first=results.get('list_files')?.files.find(f=>f.type!=='campaign');if(first&&names.has('read_range')&&!results.has('read_range'))return call('author_range','read_range',{id:first.id,startLine:1,endLine:40});
  if(/clarify/i.test(question)&&names.has('ask_author')&&!results.has('ask_author'))return call('author_question','ask_author',{text:'What should the authoring proposal focus on?',options:['World details','Hold']});
  if(create){const proposal={summary:'Synthetic authored House draft for review',creates:[buildWorldDraft({id:'auth_house_'+hash(question).slice(0,24),type:'house',name:create[1].trim().slice(0,100)})],edits:[]};if(names.has('preview_patch')&&!results.has('preview_patch'))return call('author_preview','preview_patch',proposal);if(names.has('propose_changes')&&!results.has('propose_changes'))return call('author_proposal','propose_changes',proposal);}
  return respond(create?'Synthetic authoring fixture: the House draft is ready for exact review; nothing was published.':'Synthetic authoring fixture: source navigation completed. Choose a specific world change or ask a question; no canon was changed.');
 }
 if(options.agentRole==='assistant'){const packet=JSON.parse(options.prompt);return respond(packet.matches.length?'The supplied sources contain '+packet.matches.length+' matching lines. Review '+packet.matches.map(match=>match.path+':'+match.line).join(', ')+'.':'The supplied source lookup has no matching evidence. Broaden the query or supply a source.');}
 if(options.responseFormat==='json_object'){
  const packet=JSON.parse(options.messages[0].content),actor=packet.sources.find(s=>s.id===packet.actorId),treatment=packet.sources.find(s=>s.record.type==='event'&&/cleans and binds/.test(s.record.data.body));
  const heal=/healer|treat|hand/i.test(packet.question)&&treatment,goal=actor.record.data.goals.find(g=>/grain/i.test(g)),trade=/grain|contract|negotiat/i.test(packet.question)&&goal;
  const hold={id:'hold',intent:'Wait for more information',grounds:[]},option=heal?{id:'cooperate',intent:'Accept the healer\'s help',grounds:[{sourceId:treatment.id,sourceHash:treatment.hash,section:'Account',quote:treatment.record.data.body}]}:trade?{id:'bargain',intent:'Discuss terms while protecting the grain road',grounds:[{sourceId:actor.id,sourceHash:actor.hash,section:'Goals',quote:goal}]}:null;
  return respond(JSON.stringify({selected:option?.id||'hold',options:option?[option,hold]:[hold]}));
 }
 const config=options.campaignContextPacket,directory=[...config.campaignContext.searchable,...config.campaignContext.pinned,...config.campaignContext.partial],characters=directory.filter(row=>row.type==='character'),campaign=config.campaignContext.campaign,activeActor=campaign?.activePovId||campaign?.playerId||characters[0]?.id||'campaign';
 const decisionActor=activeActor===campaign?.playerId?characters.find(row=>row.id!==campaign.playerId)?.id:characters.find(row=>row.id===activeActor)?.id;
 const messages=options.messages,request=messages.find(m=>m.role==='user')?.content||'',tools=messages.filter(m=>m.role==='tool'&&!m.isError),completed=new Set(tools.map(m=>m.toolName));
 const tool=(id,name,args)=>respond('',[{id,name,arguments:args}]);
 if(!completed.has('read_record'))return tool('source','read_record',{id:activeActor});
 if(options.tools.some(t=>t.name==='grep')&&!completed.has('grep'))return tool('search','grep',{query:/healer|treat|hand/i.test(request)?'healer':'grain'});
 if(decisionActor&&options.tools.some(t=>t.name==='npc_decision')&&!completed.has('npc_decision'))return tool('actor','npc_decision',{actorId:decisionActor,question:/healer|treat|hand/i.test(request)?'Consider accepting healer treatment':'Consider negotiating a grain contract'});
 const answer=messages.findLast(m=>m.role==='user'&&m.content.startsWith('Author selected intent:'));
 if(options.tools.some(t=>t.name==='ask_author')&&/ask.*question|ask me|clarify/i.test(request)&&!completed.has('ask_author'))return tool('question','ask_author',{text:'Which intention should the envoy pursue?',options:['Discuss terms','Seek more information','Hold position']});
 if(completed.has('ask_author')&&!answer)return respond('Awaiting the saved author answer.');
 if(options.tools.some(t=>t.name==='roll_check')&&/roll|dice|d20/i.test(request)&&!completed.has('roll_check'))return tool('roll','roll_check',{sides:20});
 const source=JSON.parse(tools.find(t=>t.toolName==='read_record').content),decision=tools.some(t=>t.toolName==='npc_decision')?JSON.parse(tools.find(t=>t.toolName==='npc_decision').content):{selected:'hold'},type=options.campaignContextPacket.actionType;
 const heal=config.campaignContext.campaign?.toolPolicy?.edit!==false&&activeActor==='mira'&&/healer|treat|hand/i.test(request)&&!['think','ooc','pov'].includes(type);
 const sceneName=directory.find(row=>row.id===(campaign?.sceneLocationId||source.record.data.current?.locationId))?.name||'the current scene',actorName=directory.find(row=>row.id===decisionActor)?.name||'The court',knownActors=source.record.type==='character'?[source.record.id]:[];
 const body=heal?"The castle healer cleans and binds Mira's wounded hand. Mira rests beside the court's hearth, recovering after treatment.":`At ${sceneName}, the submitted ${type} action remains the player's intention: ${request}. ${actorName} considers ${decision.selected}; no successful bargain, betrayal or courtship is assumed.${answer?' '+answer.content:''}`;
 if(!completed.has('stage_narration'))return tool('narration','stage_narration',{body,name:heal?'Treatment at the river court':'The river court responds',actorIds:knownActors,knownBy:['think','ooc','pov'].includes(type)?[]:knownActors,visibility:['think','ooc','pov'].includes(type)?'secret':'public',worldTime:'Current scene',assertions:heal?[{subjectId:'mira',field:'data.current.condition',value:'Recovering after treatment',kind:'event',support:"The castle healer cleans and binds Mira's wounded hand."}]:[],expectedHashes:heal?{mira:source.hash}:{}});
 const staged=JSON.parse(tools.findLast(t=>t.toolName==='stage_narration').content);
 return respond(staged.body||body);
}