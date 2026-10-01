export function availableModels(settings) {
  return (settings?.providers||[]).filter(p=>p.enabled).flatMap(p=>(p.models||[]).map(model=>({id:p.id+':'+model,name:model,provider:p.name,capabilities:{vision:!!p.vision,audio:!!p.audio,tools:p.tools!==false,...p.modelCapabilities?.[model]}})));
}
export function resolveModel(settings,selection) {
  const id=selection==='auto'?settings?.defaultModel:selection;
  if(id==='mcp:external')return {id,name:'外部 MCP 助手',provider:'MCP',capabilities:{vision:false,audio:false,tools:true}};
  return availableModels(settings).find(m=>m.id===id)||null;
}
export function attachmentModelIssue(model,refs) {
  if(!model)return '请先选择模型，或在模型提供商中添加可用模型';
  if(refs.some(r=>r.media==='image'||r.url?.startsWith('data:image/'))&&!model.capabilities.vision)return '所选模型未启用图像能力，请更换支持图片的模型或在模型设置中启用';
  if(refs.some(r=>r.media==='audio')&&!model.capabilities.audio)return '所选模型未启用音频能力，请更换模型或在模型设置中启用';
  return null;
}
