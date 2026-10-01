import {el,esc,uid,toast,confirmDlg,promptDlg,openModal} from '../core/ui.js';
import {icon} from '../core/icons.js';

const formats=[['openai','OpenAI Compatible'],['gemini','Google Gemini'],['deepseek','DeepSeek · Compatible']];
const defaults={openai:'https://api.openai.com/v1',gemini:'https://generativelanguage.googleapis.com/v1beta',deepseek:'https://api.deepseek.com/v1'};
const capDefault=p=>({text:true,vision:!!p.vision,audio:!!p.audio,tools:p.tools!==false,contextWindow:0,bodyParams:{}});
const jsonObject=text=>{const obj=JSON.parse(text||'{}');if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('请填写 JSON 对象');return obj;};

export function mountProviders(app,host,options){
  let settings=structuredClone(options.settings),p=null,dirty=false,disposed=false;
  host.innerHTML=`<div class="provider-workspace"><aside class="provider-sources"><header><b>提供商源</b><button class="btn small" data-add-provider>${icon('plus',15)}新增</button></header><div class="provider-source-list"></div><footer><label>默认模型<select data-default-model></select></label></footer></aside><main class="provider-config-host"></main></div>`;
  const sourceList=host.querySelector('.provider-source-list'),main=host.querySelector('.provider-config-host');
  const change=()=>{dirty=true;options.onDirty(true);main.querySelector('[data-save-provider]').disabled=false;main.querySelector('[data-save-state]').textContent='尚未保存';};
  function paintSources(){
    sourceList.innerHTML='';
    for(const item of settings.providers){
      const row=el(`<div class="provider-source-row ${p?.id===item.id?'on':''}"><button data-choose><img src="/app/assets/providers/${esc(item.format||item.protocol||'openai')}.svg" alt=""><span><b>${esc(item.name)}</b><small>${esc(item.baseUrl)}</small></span></button><button class="icon-btn sm" data-remove aria-label="删除 ${esc(item.name)}" data-tip="删除连接">${icon('trash',15)}</button></div>`);
      row.querySelector('[data-choose]').onclick=async()=>{if(p?.id===item.id)return;if(await options.canLeave())edit(item);};
      row.querySelector('[data-remove]').onclick=async()=>{
        if(!await confirmDlg({title:'删除连接',body:`删除「${esc(item.name)}」及本地密钥？`,okLabel:'删除',danger:true}))return;
        try{settings=await app.api.saveSettings({providers:[{id:item.id,deleted:true}]},{toast:false});options.onSaved(settings);app.bus.emit('settings');if(p?.id===item.id)edit(settings.providers[0]);else paintSources();}catch(e){toast(e.message,'err');}
      };
      sourceList.append(row);
    }
    const select=host.querySelector('[data-default-model]');
    select.innerHTML='<option value="">未设置</option><option value="mcp:external">外部 MCP 助手</option>'+settings.providers.filter(p=>p.enabled).flatMap(p=>p.models.map(m=>`<option value="${esc(p.id+':'+m)}">${esc(p.name+' / '+m)}</option>`)).join('');select.value=settings.defaultModel;
    select.onchange=async()=>{try{settings=await app.api.saveSettings({providers:[],defaultModel:select.value},{toast:false});options.onSaved(settings);app.bus.emit('settings');}catch(e){toast(e.message,'err');}};
  }
  function edit(existing){
    dirty=false;options.onDirty(false);
    p=existing?structuredClone(existing):null;paintSources();
    if(!p){main.innerHTML='<div class="studio-empty"><h2>添加一个模型连接</h2><p>选择接口格式并填入 API 地址。</p></div>';return;}
    p.modelCapabilities ||= {};p.models ||= [];const editing=p;let discovered=[],metadata={};
    main.innerHTML=`<header class="provider-config-header"><div><h2 data-provider-title>${esc(p.name)}</h2><p data-provider-url>${esc(p.baseUrl||'配置 API 连接')}</p></div><span data-save-state role="status"></span><button class="btn primary" data-save-provider type="submit" form="provider-config" disabled>${icon('check',16)}保存配置</button></header>
    <form id="provider-config" class="provider-config" autocomplete="off"><section><h3>设置</h3>
    <div class="provider-setting-row"><div><b>名称</b><p>用于区分不同的接口来源</p></div><input name="connectionName" required maxlength="80" value="${esc(p.name)}" autocomplete="off" aria-label="提供商名称"></div>
    <div class="provider-setting-row"><div><b>接口格式</b><p>第三方或中转 API 通常使用 Compatible</p></div><select name="format" aria-label="接口格式">${formats.map(([id,name])=>`<option value="${id}" ${(p.format||p.protocol||'openai')===id?'selected':''}>${name}</option>`).join('')}</select></div>
    <div class="provider-setting-row"><div><b>API Key</b><p>${p.hasKey?'已保存，留空保留':'连接密钥'}</p></div><div class="credential-field" data-private><input id="provider-credential" name="connectionCredential" class="credential-masked" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore aria-label="API Key" placeholder="${p.hasKey?esc(p.keyHint):'粘贴 API Key'}"><button class="icon-btn" type="button" data-reveal aria-label="显示 API Key" aria-pressed="false">${icon('eye',18)}</button></div></div>
    <div class="provider-setting-row"><div><b>API Base URL</b><p>自定义 API 端点地址</p></div><input name="baseUrl" type="url" required autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1" value="${esc(p.baseUrl||'')}" aria-label="API Base URL"></div>
    <div class="provider-setting-row"><div><b>连接选项</b></div><div class="provider-switches">${[['enabled','启用连接',p.enabled!==false],['noKey','无需密钥',p.noKey]].map(([name,label,on])=>`<label class="extension-toggle"><input role="switch" type="checkbox" name="${name}" ${on?'checked':''}><i class="switch-track"></i><span>${label}</span></label>`).join('')}</div></div></section>
    <details class="provider-advanced"><summary>高级配置</summary><div class="provider-setting-row"><div><b>超时时间</b><p>单次请求的等待上限，单位为秒</p></div><input name="timeoutSeconds" type="number" min="5" max="600" value="${p.timeoutSeconds||120}" aria-label="超时时间"></div><div class="provider-setting-row"><div><b>自定义请求头</b><p>JSON 对象；认证信息使用上方 API Key</p></div><textarea name="customHeaders" rows="3" spellcheck="false" aria-label="自定义请求头">${esc(JSON.stringify(p.customHeaders||{},null,2))}</textarea></div></details>
    <section class="provider-models"><header><div><h3>模型</h3><small data-model-count></small></div><input data-model-search placeholder="搜索模型或 ID" aria-label="搜索模型或 ID"><button type="button" class="btn small" data-fetch>${icon('download',15)}获取模型列表</button><button type="button" class="btn small" data-custom>${icon('plus',15)}自定义模型</button></header><p class="provider-result" role="status"></p><div class="configured-models"></div><details class="available-models" hidden><summary></summary><div></div></details></section></form>`;
    const form=main.querySelector('form'),credential=form.elements.connectionCredential,save=main.querySelector('[data-save-provider]'),status=main.querySelector('[data-save-state]'),result=form.querySelector('.provider-result');
    form.addEventListener('input',e=>{if(e.target!==form.querySelector('[data-model-search]'))change();});form.addEventListener('change',e=>{if(e.target!==form.querySelector('[data-model-search]'))change();});
    const collect=()=>({...p,name:form.elements.connectionName.value.trim(),format:form.elements.format.value,protocol:form.elements.format.value==='gemini'?'gemini':'openai',baseUrl:form.elements.baseUrl.value.trim(),apiKey:credential.value,enabled:form.elements.enabled.checked,noKey:form.elements.noKey.checked,timeoutSeconds:Number(form.elements.timeoutSeconds.value),customHeaders:jsonObject(form.elements.customHeaders.value)});
    form.elements.format.onchange=()=>{if(!form.elements.baseUrl.value||Object.values(defaults).includes(form.elements.baseUrl.value))form.elements.baseUrl.value=defaults[form.elements.format.value];};
    form.querySelector('[data-reveal]').onclick=e=>{const visible=credential.classList.toggle('credential-visible');credential.classList.toggle('credential-masked',!visible);e.currentTarget.setAttribute('aria-pressed',String(visible));e.currentTarget.setAttribute('aria-label',visible?'隐藏 API Key':'显示 API Key');};
    form.onsubmit=async e=>{
      e.preventDefault();if(!form.reportValidity())return;save.disabled=true;
      try{settings=await app.api.saveSettings({providers:[collect()]},{toast:false});options.onSaved(settings);app.bus.emit('settings');if(disposed||p!==editing)return;Object.assign(p,settings.providers.find(x=>x.id===p.id));credential.value='';credential.placeholder=p.keyHint||'粘贴 API Key';dirty=false;options.onDirty(false);status.className='saved';status.textContent='已保存';main.querySelector('[data-provider-title]').textContent=p.name;main.querySelector('[data-provider-url]').textContent=p.baseUrl;paintSources();}
      catch(e){status.className='error-text';status.textContent=e.message;save.disabled=false;}
    };
    const setResult=(text,error=false)=>{result.textContent=text;result.classList.toggle('error-text',error);};
    const addModel=model=>{if(!model?.trim())return;model=model.trim();p.models=[...new Set([...p.models,model])];p.modelCapabilities[model]||={...capDefault(p),...metadata[model]};change();paintModels();};
    function modelSettings(model){
      const cap={...capDefault(p),...p.modelCapabilities[model]};
      const body=el(`<form class="model-settings-form"><label class="extension-toggle"><span>启用模型</span><input role="switch" type="checkbox" name="enabled" ${p.models.includes(model)?'checked':''}><i class="switch-track"></i></label><div class="model-setting"><div><b>模型能力</b><p>模型支持的模态及能力</p></div><div class="model-modal-capabilities">${[['text','文本'],['vision','图像'],['audio','音频'],['tools','工具使用']].map(([key,label])=>`<label><input type="checkbox" name="${key}" ${cap[key]?'checked':''}>${label}</label>`).join('')}</div></div><div class="model-setting"><div><b>自定义请求体参数</b><p>例如 temperature、top_p、max_tokens、reasoning_effort。使用 JSON 对象。</p></div><textarea name="bodyParams" rows="4" aria-label="自定义请求体参数" spellcheck="false">${esc(JSON.stringify(cap.bodyParams||{},null,2))}</textarea></div><div class="model-setting"><div><b>模型上下文窗口大小</b><p>单位 tokens；0 表示未知，可从模型列表元数据填入。</p></div><input name="contextWindow" type="number" min="0" max="10000000" step="1" value="${cap.contextWindow||0}" aria-label="模型上下文窗口大小"></div><p class="error-text" role="status"></p></form>`);
      openModal({title:'模型设置 · '+model,width:760,body,actions:[{label:'取消'},{label:'保存',kind:'primary',onClick:close=>{try{if(!body.reportValidity())return;const f=body.elements;const bodyParams=jsonObject(f.bodyParams.value);p.modelCapabilities[model]={...Object.fromEntries(['text','vision','audio','tools'].map(k=>[k,f[k].checked])),contextWindow:Number(f.contextWindow.value),bodyParams};p.models=f.enabled.checked?[...new Set([...p.models,model])]:p.models.filter(x=>x!==model);change();paintModels();close();}catch(e){body.querySelector('[role=status]').textContent=e.message;}}}]});
      body.onsubmit=e=>e.preventDefault();
    }
    const testing=new Set();
    function paintModels(){
      const search=form.querySelector('[data-model-search]').value.toLowerCase(),list=form.querySelector('.configured-models');list.innerHTML='';
      const models=[...new Set([...p.models,...Object.keys(p.modelCapabilities)])];
      form.querySelector('[data-model-count]').textContent=`${p.models.length} 个已启用 · ${models.length} 个已配置`;
      for(const model of models.filter(m=>m.toLowerCase().includes(search))){
        const cap={...capDefault(p),...p.modelCapabilities[model]};
        const row=el(`<article class="provider-model-row"><div class="provider-model-info"><b>${esc(model)}</b><small>${esc(p.id)} / ${esc(model)}</small><div class="model-badges">${[['vision','image','图像'],['audio','volume','音频'],['tools','code','工具使用']].filter(([k])=>cap[k]).map(([,glyph,title])=>`<span data-tip="${title}" aria-label="${title}">${icon(glyph,14)}</span>`).join('')}${cap.contextWindow?`<span>${esc(cap.contextWindow>=1000000?cap.contextWindow/1000000+'M':Math.round(cap.contextWindow/1000)+'K')}</span>`:''}</div><p class="model-test-result" role="status"></p></div><div class="model-row-actions"><label class="extension-toggle"><input role="switch" type="checkbox" aria-label="启用 ${esc(model)}" ${p.models.includes(model)?'checked':''}><i class="switch-track"></i></label><button type="button" class="icon-btn" data-test data-tip="测试模型（单次请求）" aria-label="测试 ${esc(model)}" ${testing.has(model)?'disabled':''}>${icon('plug',17)}</button><button type="button" class="icon-btn" data-model-settings data-tip="模型设置" aria-label="设置 ${esc(model)}">${icon('settings',17)}</button><button type="button" class="icon-btn" data-remove-model data-tip="删除模型" aria-label="删除 ${esc(model)}">${icon('trash',17)}</button></div></article>`);
        row.querySelector('input').onchange=e=>{p.modelCapabilities[model]||=cap;p.models=e.target.checked?[...new Set([...p.models,model])]:p.models.filter(m=>m!==model);change();paintModels();};
        row.querySelector('[data-model-settings]').onclick=()=>modelSettings(model);
        row.querySelector('[data-remove-model]').onclick=()=>{p.models=p.models.filter(m=>m!==model);delete p.modelCapabilities[model];change();paintModels();};
        row.querySelector('[data-test]').onclick=async e=>{
          if(testing.has(model))return;testing.add(model);const button=e.currentTarget,feedback=row.querySelector('.model-test-result');button.disabled=true;feedback.className='model-test-result';feedback.textContent='正在测试…';
          try{const response=await app.api.testModel({provider:collect(),model});feedback.textContent=`连接成功 · ${response.latencyMs} ms · 1 次请求`;feedback.classList.add('success-text');}
          catch(error){feedback.textContent=error.message;feedback.classList.add('error-text');}
          finally{testing.delete(model);button.disabled=false;}
        };list.append(row);
      }
      if(!list.children.length)list.innerHTML='<p class="models-empty">暂无匹配的模型。获取模型列表，或添加自定义模型。</p>';
      const available=form.querySelector('.available-models'),candidates=discovered.filter(m=>!models.includes(m)&&m.toLowerCase().includes(search));available.hidden=!candidates.length;available.querySelector('summary').textContent=`可添加的模型（${candidates.length}）`;available.querySelector('div').innerHTML='';
      for(const model of candidates){const row=el(`<button type="button" class="available-model">${esc(model)}${icon('plus',15)}</button>`);row.onclick=()=>addModel(model);available.querySelector('div').append(row);}
    }
    form.querySelector('[data-model-search]').oninput=paintModels;
    form.querySelector('[data-custom]').onclick=async()=>addModel(await promptDlg({title:'自定义模型',label:'模型 ID',placeholder:'提供商支持的完整模型 ID',okLabel:'添加'}));
    form.querySelector('[data-fetch]').onclick=async e=>{if(!form.reportValidity())return;const button=e.currentTarget;button.disabled=true;try{const response=await app.api.extension('providers/discover',collect(),'POST');if(disposed||p!==editing)return;discovered=response.models;metadata=response.metadata||{};for(const model of p.models){const capacity=metadata[model]?.contextWindow;if(Number.isInteger(capacity)&&capacity>0&&capacity<=10000000&&!p.modelCapabilities[model]?.contextWindow){p.modelCapabilities[model]={...capDefault(p),...p.modelCapabilities[model],contextWindow:capacity};change();}}paintModels();form.querySelector('.available-models').open=true;setResult(`已获取 ${discovered.length} 个模型，选择需要添加的模型。`);}catch(error){setResult(error.message,true);}finally{button.disabled=false;}};
    paintModels();
  }
  host.querySelector('[data-add-provider]').onclick=async()=>{if(!await options.canLeave())return;const item={id:uid('provider'),name:'新连接',baseUrl:'',models:[],modelCapabilities:{},protocol:'openai',format:'openai',enabled:true};settings.providers.push(item);edit(item);change();main.querySelector('[name=connectionName]').select();};
  edit(settings.providers[0]);
  return ()=>{disposed=true;};
}
