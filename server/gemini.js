'use strict';
const {ApiError}=require('./store');
async function complete({p,model,messages,tools,think,signal,maxTokens,call}) {
  const contents=[], system=[], names=new Map();
  for(const m of messages){
    if(m.role==='system'){system.push(m.content);continue;}
    if(m.role==='tool'){
      let response;try{response=JSON.parse(m.content);}catch{response={result:m.content};}
      contents.push({role:'user',parts:[{functionResponse:{name:names.get(m.tool_call_id)||m.name||'tool',response:typeof response==='object'&&response!==null&&!Array.isArray(response)?response:{result:response}}}]});continue;
    }
    const parts=[];
    if(m.geminiParts)parts.push(...m.geminiParts);
    else {
      for(const c of Array.isArray(m.content)?m.content:[{type:'text',text:m.content}]){
        if(c.type==='text'&&c.text)parts.push({text:c.text});
        if(c.type==='image_url'){
          const match=c.image_url.url.match(/^data:([^;]+);base64,(.+)$/s);
          if(!match)throw new ApiError(400,'Gemini 图片需要内嵌数据');
          parts.push({inlineData:{mimeType:match[1],data:match[2]}});
        }
        if(c.type==='input_audio')parts.push({inlineData:{mimeType:c.input_audio.format==='wav'?'audio/wav':'audio/mpeg',data:c.input_audio.data}});
      }
      for(const c of m.tool_calls||[])parts.push({functionCall:{name:c.function.name,args:JSON.parse(c.function.arguments||'{}')}});
    }
    for(const c of m.tool_calls||[])names.set(c.id,c.function.name);
    if(parts.length)contents.push({role:m.role==='assistant'?'model':'user',parts});
  }
  const level=require('./reasoning').normalizeThink(think);
  const generationConfig={maxOutputTokens:maxTokens};
  if(/gemini-3/.test(model)){
    if(!['low','medium','high'].includes(level))throw new ApiError(400,`Gemini 原生接口不支持 ${level} 思考档位，请选择 low / medium / high；未自动降档`);
    generationConfig.thinkingConfig={thinkingLevel:level};
  }else if(/gemini-2\.5/.test(model)){
    const budget={low:128,medium:1024,high:4096,xhigh:8192,max:16384,ultra:24576}[level];
    if(budget+512>maxTokens)throw new ApiError(400,`Gemini ${level} 原生思考预算需要至少 ${budget+512} 个输出 token，当前可用 ${maxTokens}；请选择较低档位或兼容接口，未自动降档`);
    generationConfig.thinkingConfig={thinkingBudget:budget};
  }
  const body={contents,systemInstruction:{parts:[{text:system.join('\n')}]},generationConfig:{...p.bodyParams,...generationConfig}};
  if(tools?.length&&p.tools!==false)body.tools=[{functionDeclarations:tools.map(t=>({name:t.function.name,description:t.function.description,parametersJsonSchema:t.function.parameters}))}];
  const j=await call(p,'models/'+encodeURIComponent(model.replace(/^models\//,''))+':generateContent',body,signal);
  const candidate=j.candidates?.[0], parts=candidate?.content?.parts;
  if(!parts?.length)throw new ApiError(502,'Gemini 未返回内容：'+(j.promptFeedback?.blockReason||candidate?.finishReason||'empty'));
  const tool_calls=parts.filter(x=>x.functionCall).map((x,i)=>({id:'gemini-'+Date.now()+'-'+i,type:'function',function:{name:x.functionCall.name,arguments:JSON.stringify(x.functionCall.args||{})}}));
  return {message:{role:'assistant',content:parts.filter(x=>x.text&&!x.thought).map(x=>x.text).join('\n'),...(tool_calls.length?{tool_calls}:{}),geminiParts:parts},usage:j.usageMetadata?{total_tokens:j.usageMetadata.totalTokenCount,prompt_tokens:j.usageMetadata.promptTokenCount,completion_tokens:j.usageMetadata.candidatesTokenCount}:null,finishReason:candidate.finishReason==='MAX_TOKENS'?'length':candidate.finishReason};
}
module.exports={complete};
