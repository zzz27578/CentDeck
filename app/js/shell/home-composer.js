import {el,esc,uid,toast,showMenu} from '../core/ui.js';
import {icon} from '../core/icons.js';
import {readAttachment,ATTACHMENT_ACCEPT,MAX_ATTACHMENTS} from '../agent/attachments.js';
import {availableModels,resolveModel,attachmentModelIssue} from '../agent/model-options.js';

export function mountHomeComposer(app,root,start) {
  const box=root.querySelector('.hero-prompt'),ta=box.querySelector('textarea');
  const draft=app.homeDraft ||= {text:'',target:'web',model:'auto',refs:[]};
  let settings=null,disposed=false,starting=false,uploads=Promise.resolve();
  const modelButton=box.querySelector('[data-a=model]'),send=box.querySelector('[data-a=go]'),input=box.querySelector('[data-attachments]');
  ta.value=draft.text;input.accept=ATTACHMENT_ACCEPT;
  const paintTarget=()=>{
    box.querySelector('.target-switch').dataset.value=draft.target;
    box.querySelectorAll('[data-target]').forEach(b=>{const on=b.dataset.target===draft.target;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
  };
  box.querySelectorAll('[data-target]').forEach(b=>b.onclick=()=>{draft.target=b.dataset.target;paintTarget();});paintTarget();
  ta.oninput=()=>{draft.text=ta.value;};
  const paintModel=()=>{
    const model=resolveModel(settings,draft.model);
    modelButton.querySelector('span').textContent=model?.name||'选择模型';
    modelButton.title=model?model.provider+' / '+model.name:'选择本次设计使用的模型';
    modelButton.classList.toggle('needs-model',!model);
  };
  const loadModels=async()=>{try{const result=await app.api.getSettings();if(disposed)return;settings=result;paintModel();}catch{if(!disposed)paintModel();}};
  let modelReady=loadModels();
  const off=app.bus.on('settings',()=>{modelReady=loadModels();});
  modelButton.onclick=async()=>{
    await modelReady;if(disposed)return;
    const list=availableModels(settings),items=[{title:'本次设计的模型'}];
    if(resolveModel(settings,'auto'))items.push({label:'默认模型',hint:resolveModel(settings,'auto').name,checked:draft.model==='auto',onClick:()=>{draft.model='auto';paintModel();}});
    for(const model of list)items.push({label:model.name,hint:model.provider,checked:draft.model===model.id,onClick:()=>{draft.model=model.id;paintModel();}});
    items.push({label:'外部 MCP 助手',hint:'需要外部客户端接管',checked:draft.model==='mcp:external',onClick:()=>{draft.model='mcp:external';paintModel();}},'-',{label:'模型提供商设置',icon:'settings',onClick:()=>app.openSettings('providers')});
    showMenu(items,0,0,{anchor:modelButton,minWidth:260});
  };
  const paintRefs=()=>{
    const host=box.querySelector('.home-attachments');host.innerHTML='';host.hidden=!draft.refs.length;
    for(const ref of draft.refs){
      const item=el(`<div class="home-attachment">${ref.media==='image'?`<img src="${esc(ref.url)}" alt="">`:icon(ref.media==='audio'?'volume':'file',19)}<span><b>${esc(ref.name)}</b><small>${Math.max(1,Math.ceil(ref.size/1024))} KB</small></span><button aria-label="移除附件 ${esc(ref.name)}">${icon('close',14)}</button></div>`);
      item.querySelector('button').onclick=()=>{draft.refs=draft.refs.filter(r=>r.id!==ref.id);paintRefs();};host.append(item);
    }
  };paintRefs();
  function addFiles(files){
    uploads=uploads.then(async()=>{
      for(const file of files){
        if(disposed)return;
        if(draft.refs.length>=MAX_ATTACHMENTS){toast('一次最多添加 4 个参考附件','err');break;}
        try{const ref=await readAttachment(file);if(!disposed){draft.refs.push({id:uid('attachment'),...ref});paintRefs();}}catch(error){toast(error.message,'err');}
      }
    });return uploads;
  }
  box.querySelector('[data-a=attach]').onclick=()=>input.click();
  input.onchange=()=>{addFiles([...input.files]);input.value='';};
  const isFiles=e=>[...e.dataTransfer?.types||[]].includes('Files');
  box.ondragenter=e=>{if(isFiles(e)){e.preventDefault();e.stopPropagation();root.querySelector('.drop-veil')?.classList.remove('show');box.classList.add('has-file-drag');}};
  box.ondragover=e=>{if(isFiles(e)){e.preventDefault();e.stopPropagation();}};
  box.ondragleave=e=>{e.stopPropagation();if(!box.contains(e.relatedTarget))box.classList.remove('has-file-drag');};
  box.ondrop=e=>{if(isFiles(e)){e.preventDefault();e.stopPropagation();box.classList.remove('has-file-drag');root.querySelector('.drop-veil')?.classList.remove('show');addFiles([...e.dataTransfer.files]);}};
  box.onpaste=e=>{const files=[...e.clipboardData?.files||[]];if(files.length){e.preventDefault();addFiles(files);}};
  const go=async()=>{
    if(starting)return;starting=true;send.disabled=true;send.setAttribute('aria-busy','true');
    try{
      await Promise.all([uploads,modelReady]);if(disposed)return;
      const text=ta.value.trim();if(!text&&!draft.refs.length){ta.focus();return;}
      const model=resolveModel(settings,draft.model),issue=attachmentModelIssue(model,draft.refs);
      if(issue){toast(issue,'err');modelButton.focus();return;}
      const done=await start({text:text||'请参考这些附件设计页面',target:draft.target,model:model.id,refs:structuredClone(draft.refs)});
      if(done)app.homeDraft={text:'',target:draft.target,model:draft.model,refs:[]};
    }catch(error){toast(error.message,'err');}finally{starting=false;send.disabled=false;send.removeAttribute('aria-busy');}
  };
  send.onclick=go;
  ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();go();}};
  return ()=>{disposed=true;off();};
}
