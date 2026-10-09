import {hash} from './store.mjs';
/** Plain-JS adaptation of engine/agentRuntime.ts compactAgentRuntimeMessages:
 * project old tool bodies into handles, retain raw history and recent dialogue.
 * Unknown receipts and author questions/rolls are never inferred away. */
export function projectToolBodies(messages,maxBytes){
 const projected=structuredClone(messages),omitted=[],recentUser=messages.findLastIndex(m=>m.role==='user'),lastAssistant=messages.findLastIndex(m=>m.role==='assistant');
 const size=()=>Buffer.byteLength(JSON.stringify(projected));
 function handles(value,depth=0){if(!value||typeof value!=='object'||depth>8)return [];const found=[];if(typeof value.path==='string'&&/^records\/[a-z][a-z0-9_-]*\.md$/.test(value.path)&&/^[a-f0-9]{64}$/.test(value.hash||''))found.push({path:value.path,hash:value.hash});for(const child of Object.values(value))if(child&&typeof child==='object')found.push(...handles(child,depth+1));return [...new Map(found.map(r=>[r.path+r.hash,r])).values()].slice(0,50);}
 for(let index=0;index<projected.length&&size()>maxBytes;index++){
  const message=projected[index];if(message.role!=='toolResult'||index>=Math.max(recentUser,lastAssistant-3)||!['read_record','recall','grep'].includes(message.toolName))continue;
  const body=message.content.filter(c=>c.type==='text').map(c=>c.text).join('');let sourceRefs;try{sourceRefs=handles(JSON.parse(body));}catch{continue;}if(!sourceRefs.length)continue;
  const text=JSON.stringify({omitted:'Older tool body omitted from this request. Re-read exact sources before claiming details.',sourceRefs,toolCallId:message.toolCallId});if(text.length>=body.length)continue;
  message.content=[{type:'text',text}];omitted.push({index,toolCallId:message.toolCallId,sourceRefs,bodyHash:hash(body)});
 }
 return {messages:projected,omitted,bytes:size(),fits:size()<=maxBytes};
}
