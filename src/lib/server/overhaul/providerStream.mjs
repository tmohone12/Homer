/** Bounded OpenAI/Anthropic SSE reader. No fetch, credential lookup, tool execution or canon writes. */
/** @param {Response} response @param {any} options @returns {Promise<any>} */
export async function readCampaignProviderStream(response,{useAnthropic=false,onTextDelta,normalizeUsage,emptyUsage={},startTime=Date.now(),onProgress,signal}={}){
 if(!response.body)throw Error('Provider streaming response had no body.');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),tools=new Map(),blocks=new Map(),continuation={};
 let buffer='',text='',usage=emptyUsage,anthropicUsage={},finishReason=null,providerRequestId=null,timeToFirstTokenMs=null,wireBytes=0,eventCount=0,terminated=false,completed=false;
 const check=()=>{if(signal?.aborted)throw Error('Provider stream cancelled.');};
 const progress=()=>onProgress?.({text,usage,finishReason,providerRequestId});
 const fragment=(value,label)=>{if(typeof value!=='string'||value.length>65536)throw Error('Invalid streamed '+label);return value;};
 const indexOf=(value,max=7)=>{if(!Number.isInteger(value)||value<0||value>max)throw Error('Invalid streamed tool/block index.');return value;};
 const deltaText=async chunk=>{check();if(!chunk)return;if(terminated||finishReason)throw Error('Text after provider stream completion.');if(text.length+chunk.length>16000)throw Error('Provider streamed text exceeds its bound.');text+=chunk;timeToFirstTokenMs??=Math.max(0,Date.now()-startTime);progress();await onTextDelta?.(chunk);check();};
 const toolEntry=index=>{if(!tools.has(index)){if(tools.size>=8)throw Error('Too many streamed tool calls.');tools.set(index,{id:'',name:'',json:''});}return tools.get(index);};
 const consume=async value=>{
  check();if(!value)return;if(value==='[DONE]'){if(useAnthropic||!finishReason)throw Error('Incomplete provider stream.');terminated=true;return;}
  if(++eventCount>10000)throw Error('Too many provider stream events.');let record;try{record=JSON.parse(value);}catch{throw Error('Malformed provider stream JSON.');}if(!record||typeof record!=='object'||Array.isArray(record))throw Error('Malformed provider stream event.');
  if(record.error||record.type==='error')throw Error('Provider returned a streamed error.');
  if(terminated)throw Error('Provider data after terminal event.');
  providerRequestId=typeof record.id==='string'?record.id:typeof record.message?.id==='string'?record.message.id:providerRequestId;
  if(useAnthropic){
   const type=record.type,delta=record.delta||{};
   if(type==='message_start'){anthropicUsage={...anthropicUsage,...record.message?.usage};usage=normalizeUsage?.({usage:anthropicUsage},true)||usage;}
   if(type==='content_block_start'){
    const index=indexOf(record.index,15),block=record.content_block;if(blocks.has(index)||!block||!['text','tool_use','thinking','redacted_thinking'].includes(block.type))throw Error('Invalid Anthropic stream block.');
    blocks.set(index,{...block,ended:false});if(block.type==='tool_use'){const tool=toolEntry(index);tool.id=fragment(block.id,'tool id');tool.name=fragment(block.name,'tool name');tool.initial=block.input;}
    if(block.type==='text'&&block.text)await deltaText(fragment(block.text,'text'));
   }
   if(type==='content_block_delta'){
    const block=blocks.get(indexOf(record.index,15));if(!block||block.ended)throw Error('Delta for unknown/closed Anthropic block.');
    if(delta.type==='text_delta'&&block.type==='text'){const chunk=fragment(delta.text,'text');block.text=(block.text||'')+chunk;await deltaText(chunk);}
    else if(delta.type==='input_json_delta'&&block.type==='tool_use'){const tool=tools.get(record.index);tool.json+=fragment(delta.partial_json,'tool arguments');}
    else if(delta.type==='thinking_delta'&&block.type==='thinking')block.thinking=(block.thinking||'')+fragment(delta.thinking,'private continuation');
    else if(delta.type==='signature_delta'&&block.type==='thinking')block.signature=(block.signature||'')+fragment(delta.signature,'private signature');
    else throw Error('Invalid Anthropic block delta.');
   }
   if(type==='content_block_stop'){const block=blocks.get(indexOf(record.index,15));if(!block||block.ended)throw Error('Invalid Anthropic block completion.');block.ended=true;}
   if(type==='message_delta'){finishReason=typeof delta.stop_reason==='string'?delta.stop_reason:finishReason;anthropicUsage={...anthropicUsage,...record.usage};usage=normalizeUsage?.({usage:anthropicUsage},true)||usage;}
   if(type==='message_stop'){if(!finishReason||[...blocks.values()].some(b=>!b.ended))throw Error('Incomplete Anthropic stream.');terminated=true;}
  }else{
   if(record.choices!==undefined&&!Array.isArray(record.choices))throw Error('Invalid streamed choices.');const first=record.choices?.[0],delta=first?.delta||{};
   if(first?.index!==undefined&&first.index!==0)throw Error('Multiple streamed choices are unsupported.');if(record.choices?.length>1)throw Error('Multiple streamed choices are unsupported.');
   if(delta.content!=null)await deltaText(fragment(delta.content,'text'));
   for(const c of delta.tool_calls||[]){if(finishReason)throw Error('Tool arguments after completion.');const tool=toolEntry(indexOf(c.index));if(c.id!=null)tool.id+=fragment(c.id,'tool id');if(c.function?.name!=null)tool.name+=fragment(c.function.name,'tool name');if(c.function?.arguments!=null)tool.json+=fragment(c.function.arguments,'tool arguments');}
   for(const key of ['reasoning_content','reasoning'])if(typeof delta[key]==='string')continuation[key]=(continuation[key]||'')+delta[key];
   if(delta.reasoning_details!==undefined){if(!Array.isArray(delta.reasoning_details))throw Error('Invalid private continuation.');continuation.reasoning_details=[...continuation.reasoning_details||[],...delta.reasoning_details];}
   if(first?.finish_reason!=null){if(typeof first.finish_reason!=='string'||finishReason&&finishReason!==first.finish_reason)throw Error('Conflicting provider finish reason.');finishReason=first.finish_reason;}
   if(record.usage)usage=normalizeUsage?.(record,false)||usage;
  }
  if(Buffer.byteLength(JSON.stringify([...tools.values()]))>196608||Buffer.byteLength(JSON.stringify({continuation,blocks:[...blocks.values()]}))>131072)throw Error('Provider streamed tools/continuation exceed bounds.');progress();
 };
 const consumeEvent=async event=>{if(Buffer.byteLength(event)>65536)throw Error('Provider stream event exceeds 64 KiB.');const lines=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart());if(lines.length)await consume(lines.join('\n'));};
 const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{
  check();while(true){const {value,done}=await reader.read();check();if(done)break;wireBytes+=value.byteLength;if(wireBytes>1048576)throw Error('Provider stream exceeds 1 MiB wire limit.');buffer+=decoder.decode(value,{stream:true});let boundary=/\r?\n\r?\n/.exec(buffer);while(boundary){await consumeEvent(buffer.slice(0,boundary.index));buffer=buffer.slice(boundary.index+boundary[0].length);boundary=/\r?\n\r?\n/.exec(buffer);}if(buffer.length>65536)throw Error('Provider stream event exceeds 64 KiB.');}
  buffer+=decoder.decode();if(buffer.trim())await consumeEvent(buffer);check();if(!terminated||!['stop','end_turn','tool_calls','tool_use','function_call'].includes(finishReason))throw Error('Incomplete or truncated provider stream.');
  const toolCalls=[...tools.entries()].sort(([a],[b])=>a-b).map(([,tool])=>{let args;try{args=tool.json?JSON.parse(tool.json):tool.initial;}catch{throw Error('Malformed completed tool arguments.');}if(!/^[A-Za-z0-9_-]{1,100}$/.test(tool.id)||!tool.name||tool.name.length>80||!args||typeof args!=='object'||Array.isArray(args))throw Error('Invalid completed streamed tool call.');if(tool.json&&tool.initial&&Object.keys(tool.initial).length)throw Error('Ambiguous tool arguments.');return {id:tool.id,name:tool.name,arguments:args};});
  if(new Set(toolCalls.map(c=>c.id)).size!==toolCalls.length)throw Error('Duplicate streamed tool IDs.');if(toolCalls.length&&!['tool_calls','tool_use','function_call'].includes(finishReason))throw Error('Tool stream missing a tool completion reason.');
  if(useAnthropic){const content=[...blocks.entries()].sort(([a],[b])=>a-b).map(([index,block])=>{const {ended,...original}=block;return block.type==='tool_use'?{...original,input:toolCalls.find(c=>c.id===tools.get(index)?.id)?.arguments}:original;});continuation.anthropicContent=content;}
  if(Buffer.byteLength(JSON.stringify(continuation))>65536)throw Error('Private provider continuation exceeds 64 KiB.');completed=true;return {text,toolCalls,providerContinuation:continuation,usage,finishReason,timeToFirstTokenMs,providerRequestId};
 }finally{signal?.removeEventListener('abort',abort);if(!completed)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
