/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
'use strict';
const {ApiError}=require('./store');
// OpenAI-compatible SSE, with JSON fallback for compatible gateways that ignore stream.
async function readChatStream(res,onProgress){
  if(!res.headers.get('content-type')?.includes('text/event-stream')){
    let size=0;const chunks=[];
    for await(const chunk of res.body){size+=chunk.length;if(size>8*1024*1024)throw new ApiError(502,'模型响应过大');chunks.push(Buffer.from(chunk));}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(502,'模型接口没有返回有效 JSON');}
  }
  let buffer='',content='',finishReason=null,usage=null,size=0,last=0,ended=false;
  const decoder=new TextDecoder(),calls=new Map();
  function emit(phase,force=false){
    if(force||Date.now()-last>120){last=Date.now();onProgress?.({phase,content});}
  }
  function packet(line){
    if(!line.startsWith('data:'))return;
    const data=line.slice(5).trim();if(!data)return;
    if(data==='[DONE]'){ended=true;return;}
    let j;try{j=JSON.parse(data);}catch{throw new ApiError(502,'模型流包含无效数据');}
    if(j.error)throw new ApiError(502,'模型流返回错误，请检查接口');
    if(j.usage)usage=j.usage;
    const c=j.choices?.[0];if(!c)return;
    if(c.finish_reason)finishReason=c.finish_reason;
    const d=c.delta||{};
    if(typeof d.content==='string'){content+=d.content;emit('output');}
    else if(d.reasoning_content||d.reasoning)emit('thinking');
    for(const part of d.tool_calls||[]){
      const n=part.index??0,call=calls.get(n)||{id:'',type:'function',function:{name:'',arguments:''}};
      if(part.id)call.id=part.id;
      if(part.function?.name)call.function.name+=part.function.name;
      if(part.function?.arguments)call.function.arguments+=part.function.arguments;
      calls.set(n,call);emit('tool');
    }
  }
  for await(const chunk of res.body){
    size+=chunk.length;if(size>8*1024*1024)throw new ApiError(502,'模型响应过大');
    buffer+=decoder.decode(chunk,{stream:true});
    let pos;while((pos=buffer.indexOf('\n'))!==-1){packet(buffer.slice(0,pos).replace(/\r$/,''));buffer=buffer.slice(pos+1);}
  }
  buffer+=decoder.decode();if(buffer.trim())packet(buffer.trim());
  if(!finishReason&&!ended)throw new ApiError(502,'模型流提前中断，已保留收到的内容');
  if(!content&&!calls.size)throw new ApiError(502,'模型没有返回回复内容');
  emit(content?'output':'tool',true);
  return {choices:[{message:{role:'assistant',content:content||null,...(calls.size?{tool_calls:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1])}:{})},finish_reason:finishReason}],usage};
}
module.exports={readChatStream};
