const privateField=n=>n.matches?.('input[type=password],input[type=file]')||n.closest?.('[data-private],[data-sensitive]')||/password|api.?key|secret|access.?token/i.test([n.name,n.id,n.getAttribute?.('autocomplete')].filter(Boolean).join(' '));
export function visibleControl(n){
  if(!n?.isConnected||n.closest('[hidden],[inert]')||!n.getClientRects().length)return false;
  const css=n.ownerDocument.defaultView.getComputedStyle(n);return css.display!=='none'&&css.visibility!=='hidden';
}
export function controlLabel(n){
  const aria=n.getAttribute('aria-label'),refs=n.getAttribute('aria-labelledby');
  const labelled=refs?.split(/\s+/).map(id=>n.ownerDocument.getElementById(id)?.textContent||'').join(' ');
  const labels=[...n.labels||[]].map(l=>{if(!l.cloneNode)return l.textContent;const copy=l.cloneNode(true);copy.querySelectorAll('input,textarea,select,button,svg').forEach(n=>n.remove());return copy.textContent;}).join(' ');
  return (aria||labelled||n.getAttribute('data-tip')||labels||n.getAttribute('title')||n.getAttribute('placeholder')||n.innerText||n.textContent||n.name||n.id||n.tagName.toLowerCase()).trim().slice(0,160);
}
export function activeScope(doc){return [...doc.querySelectorAll('.modal-mask.show .modal,dialog[open]')].at(-1)||doc;}
export function previewText(doc){
  const scope=activeScope(doc),root=scope===doc?doc.body:scope;if(!root)return '';
  const walker=doc.createTreeWalker(root,doc.defaultView.NodeFilter.SHOW_TEXT);const text=[];let length=0,node;
  while((node=walker.nextNode())&&length<10000){const p=node.parentElement;if(!p||p.closest('script,style,input,textarea,select,[data-private],[data-sensitive]')||!visibleControl(p))continue;const value=node.textContent.trim();if(value){text.push(value);length+=value.length;}}
  return text.join('\n').slice(0,10000);
}
export function describeControl(n,id,context){
  const rect=n.getBoundingClientRect(),w=n.ownerDocument.defaultView;
  const record={id,context,tag:n.tagName.toLowerCase(),type:n.type||undefined,role:n.getAttribute('role')||undefined,label:controlLabel(n),disabled:!!n.disabled,rect:{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)},inViewport:rect.bottom>0&&rect.right>0&&rect.top<w.innerHeight&&rect.left<w.innerWidth};
  if(privateField(n))return null;
  if(n.matches('input,textarea,select'))record.value=String(n.value||'').slice(0,2000);
  if(n.matches('input[type=checkbox],input[type=radio]'))record.checked=n.checked;
  if(n.matches('select')){record.optionCount=n.options.length;record.options=[...n.options].slice(0,200).map(o=>({value:o.value,label:o.label,disabled:o.disabled}));}
  if(n.hasAttribute('aria-expanded'))record.expanded=n.getAttribute('aria-expanded')==='true';
  if(n.hasAttribute('aria-pressed'))record.pressed=n.getAttribute('aria-pressed')==='true';
  if(n.tagName==='SUMMARY')record.expanded=n.parentElement.open;
  return record;
}
export function collectControls(doc,context,identify){
  return [...activeScope(doc).querySelectorAll('button,input,textarea,select,a[href],summary,[role=button],[contenteditable=true]')].filter(visibleControl).slice(0,200).flatMap(n=>{
    if(privateField(n))return [];
    const item=describeControl(n,identify(n,context),context);return item?[item]:[];
  });
}
export function fillControl(n,value){
  if(privateField(n)||n.disabled||n.readOnly)throw Error('该字段不可填写或属于受保护字段');
  const text=String(value??'');if(text.length>32000)throw Error('填写内容最多 32000 字符');
  const w=n.ownerDocument.defaultView;
  if(n.matches('input[type=checkbox],input[type=radio]')){
    if(!['true','false'].includes(text))throw Error('勾选字段的 value 必须是 true 或 false');
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'checked').set.call(n,text==='true');
  }else if(n.matches('input:not([type=button]):not([type=submit]),textarea,select')){
    if(n.tagName==='SELECT'&&![...n.options].some(o=>!o.disabled&&o.value===text))throw Error('选项不存在或已禁用');
    const proto=n.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:n.tagName==='SELECT'?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(n,text);
  }else if(n.isContentEditable)n.textContent=text;
  else throw Error('目标不是可填写控件');
  n.dispatchEvent(new w.Event('input',{bubbles:true}));n.dispatchEvent(new w.Event('change',{bubbles:true}));
}
