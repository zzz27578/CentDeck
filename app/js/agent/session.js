// 一个助手窗口：标题栏（可拖动、停靠 / 弹出）、对话区、输入框（+ 上传与引用、@、技能、模型、思考强度）
import { icon } from "../core/icons.js";
import { el, esc, uid, showMenu, toast } from "../core/ui.js";
import { avatar, taskStatus } from "./studio.js";
import { refLabel, refKey, mentionItems, describeRefs } from "./refs.js";
import { readAttachment, ATTACHMENT_ACCEPT, MAX_ATTACHMENTS } from './attachments.js';
import { historyFor, tasksForConversation, isBusy, HISTORY_LIMIT } from './conversations.js';

import { THINK, normalizeThink } from "../core/reasoning.js";
export { THINK };
export const ROLES = [
  "通用",
  "总览设计",
  "设计师",
  "前端工程师",
  "审查员",
  "移动适配",
];

export function createSession(app, mgr, opts) {
  const s = {
    id: opts.id || uid("ag"),
    name: opts.name || "助手",
    role: opts.role || "通用",
    model: opts.model || "auto",
    think: normalizeThink(opts.think),
    avatar: opts.avatar || "centdeck",
    color: opts.color || "#65784e",
    prompt: opts.prompt || "",
    responsibility: opts.responsibility || "",
    skills: opts.skills || [],
    skill: null,
    refs: [],
    msgs: [],
    root: null,
    mode: "plan",
    task: null,
    collaboration: "off",
  };
  const root = el(`<div class="ag">
    <div class="ag-head" data-drag>
      <span class="ag-avatar"></span><button class="ag-switch" data-a="switch" aria-label="切换助手"><b class="ag-name"></b>${icon("chevDown",13)}</button>
      <button class="ag-role" data-a="role" data-tip="这个助手负责什么（多助手协作用）"></button>
      <span class="grow"></span>
      <button class="icon-btn sm" data-a="fold" aria-label="折叠窗口" data-tip="折叠窗口">${icon("minus", 15)}</button><button class="icon-btn sm" data-a="new" aria-label="在独立窗口开始新对话" data-tip="在独立窗口开始新对话">${icon("plus", 15)}</button>
      <button class="icon-btn sm" data-a="dock" data-tip="停靠到右侧 / 弹出成悬浮窗"></button>
      <button class="icon-btn sm" data-a="close" data-tip="收起" data-kbd="Ctrl+K">${icon("close", 14)}</button>
    </div>
    <button class="ag-summary" data-a="fold"><i></i><span>空闲</span></button>
    <div class="ag-conversations"><button data-a="conversations" aria-label="打开项目对话列表">${icon('history',16)}<span>新对话</span>${icon('chevDown',12)}</button><button data-a="new-chat" aria-label="开始新对话">${icon('plus',14)}新对话</button></div>
    <div class="ag-msgs" role="log" aria-label="聊天记录"></div>
    <div class="agent-composer">
      <div class="comp-controls"><div class="seg" data-mode><button data-mode-v="plan" class="on">计划</button><button data-mode-v="create">创建</button></div><select aria-label="协作方式" data-collab><option value="off">独立执行</option><option value="confirm">协作前确认</option><option value="auto">自动协作</option></select><select aria-label="修改范围" data-scope><option value="all">全站</option><option value="page">当前页</option></select></div>
      <div class="comp-chips"></div>
      <textarea rows="3" aria-label="给助手的任务" placeholder="描述你的设计…"></textarea>
      <div class="comp-bar">
        <button class="icon-btn sm" data-a="plus" data-tip="上传文件、引用页面或元素">${icon("plus", 18)}</button>
        <button class="icon-btn sm" data-a="at" aria-label="@ 助手或引用" data-tip="@ 助手、页面、元素、标记">${icon("at", 17)}</button>
        <button class="comp-pick" data-a="skill" data-tip="选择技能">${icon("book", 14)}<span>技能</span></button>
        <button class="comp-pick" data-a="model" data-tip="选模型">${icon("brain", 14)}<span></span>${icon("chevDown", 12)}</button>
        <button class="comp-pick" data-a="think" data-tip="思考强度">${icon("sparkle", 14)}<span></span>${icon("chevDown", 12)}</button>
        <span class="grow"></span>
        <button class="comp-send" data-a="send" data-tip="发送" data-kbd="Enter">${icon("send", 17)}</button>
      </div>
      <details class="chat-context"><summary>上下文 <span></span></summary><div></div></details>
      <input type="file" multiple hidden>
    </div></div>`);
  s.root = root;
  const q = (sel) => root.querySelector(sel);
  let collaborationTouched=false;
  q('[data-collab]').addEventListener('change',()=>{collaborationTouched=true;});
  app.api.extension('preferences').then(p=>{if(!collaborationTouched&&!s.msgs.length&&!s.task)q('[data-collab]').value=p.collaboration;}).catch(()=>{});
  const ta = q("textarea"),
    fileIpt = q("input[type=file]");
  fileIpt.accept=ATTACHMENT_ACCEPT;

  const grow = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(260, Math.max(76, ta.scrollHeight)) + "px";
  };
  ta.addEventListener("input", () => {
    grow();
    mgr.saveConversation(s);
  });
  q(".ag-head").ondblclick = (e) => {
    if (!e.target.closest("button")) mgr.fold(s);
  };
  ta.addEventListener("focus", () => mgr.setActive(s));
  root.addEventListener("pointerdown", () => mgr.setActive(s), true);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      ta.blur();
    }
  });
  ta.addEventListener("keyup", (e) => {
    if (e.key === "@") mention(ta);
  });

  function mention(anchor) {
    const cursor=ta.selectionStart;
    showMenu(
      [{title:'交给指定助手回复'},...mgr.sessions().map(a=>({label:a.name,hint:a.role,icon:'centdeck',checked:s.recipient===a.id,onClick:()=>{
        s.recipient=a.id;s.model=a.model;s.think=a.think;
        if(anchor===ta&&ta.value[cursor-1]==='@')ta.value=ta.value.slice(0,cursor-1)+ta.value.slice(cursor);
        paintChips();paintPickers();mgr.saveConversation(s);focus();
      }})),'-',...mentionItems(app, (r) => {
        if(anchor===ta&&ta.value[cursor-1]==='@')ta.value=ta.value.slice(0,cursor-1)+ta.value.slice(cursor);
        addRef(r);
      })],
      0,
      0,
      { anchor, minWidth: 280 },
    );
  }
  function addRef(r) {
    if (!s.refs.some((x) => refKey(x) === refKey(r)))
      s.refs.push({ id: uid("rf"), ...r });
    paintChips();
    mgr.saveConversation(s);
    focus();
  }
  function paintChips() {
    const host = q(".comp-chips");
    host.innerHTML = "";
    if(s.recipient){
      const a=mgr.sessions().find(a=>a.id===s.recipient);
      if(a){const chip=el(`<span class="comp-chip ctx recipient-chip">${icon('at',13)}<span>${esc(a.name)} 回复</span><button aria-label="取消指定助手">${icon('close',11)}</button></span>`);chip.querySelector('button').onclick=()=>{s.recipient=null;paintChips();mgr.saveConversation(s);};host.append(chip);}
    }
    const all = [
      ...(mgr.skill(s.skill) ? [{ kind: "skill", id: "skill" }] : []),
      ...s.refs,
    ];
    host.hidden = !all.length&&!s.recipient;
    all.forEach((r) => {
      const sk = r.kind === "skill" ? mgr.skill(s.skill) : null;
      const lb = sk ? { icon: sk.icon, text: "技能：" + sk.name } : refLabel(r);
      const chip = el(
        `<span class="comp-chip ${sk ? "skill" : "ctx"}" title="${esc(lb.text)}">${r.url && r.media!=='audio' ? `<img src="${r.url}" alt="">` : icon(lb.icon, 13)}<span>${esc(lb.text)}</span>${lb.color ? `<i class="cc-dot" style="background:${lb.color}"></i>` : ""}<button data-tip="移除">${icon("close", 11)}</button></span>`,
      );
      chip.querySelector("button").onclick = () => {
        if (sk) s.skill = null;
        else s.refs = s.refs.filter((x) => x.id !== r.id);
        paintChips();
        mgr.saveConversation(s);
      };
      host.appendChild(chip);
    });
  }
  function paintPickers() {
    q("[data-a=model] span").textContent = mgr.modelLabel(s.model);
    q("[data-a=think] span").textContent = (
      THINK.find((t) => t.id === s.think) || THINK[1]
    ).label;
    q(".ag-name").textContent = s.name;
    q('[data-a=conversations] span').textContent=mgr.conversationList().find(c=>c.id===s.conversationId)?.title||'新对话';
    q(".ag-avatar").innerHTML = avatar(s, 25);
    q(".ag-avatar").style.color = s.color;
    root.style.setProperty("--assistant-color", s.color);
    const status=s.task?.status||'idle';root.dataset.status=status;
    const label=status==='completed'&&s.task.commits?.length?'待验收':s.task?taskStatus(s.task):'空闲';
    q('.ag-summary span').textContent=label+' · '+(s.task?.output||s.task?.goal||'随时准备开始').slice(0,100);
    q('.ag-summary i').setAttribute('aria-label',label);
    q('[data-a=skill]').hidden=!mgr.skills().length;
    q("[data-a=role]").textContent = s.role;
    const dk = q("[data-a=dock]");
    dk.innerHTML = icon(mgr.isDocked(s) ? "undock" : "dock", 15);
    dk.setAttribute(
      "data-tip",
      mgr.isDocked(s) ? "弹出成悬浮窗（也可以直接拖标题栏）" : "停靠到右侧",
    );
    paintContext();
  }
  function paintContext(){
    const history=historyFor(s.msgs),c=s.task?.context;
    q('.chat-context summary span').textContent=`${history.length} 条消息${c?' · 约 '+c.estimatedInputTokens.toLocaleString()+' tokens':''}`;
    q('.chat-context > div').textContent=`模型：${mgr.modelLabel(s.model)}\n下次回复携带最近 ${history.length} 条消息（最多 ${HISTORY_LIMIT} 条），新对话从空历史开始。${c?'\n上次请求输入估算：'+c.estimatedInputTokens+' tokens，包含当时的系统规范、消息、工具定义和工具结果；不是模型容量占比。':''}\n当前引用：${describeRefs(app,s.refs).join('；')||'无'}\n范围：${q('[data-scope]').value==='page'?(app.state.page||'全站'):'全站'} · ${s.mode==='create'?'创建':'计划'}`;
  }
  function paintMsgs() {
    const host = q(".ag-msgs");
    const atBottom=host.scrollHeight-host.scrollTop-host.clientHeight<80;
    const existing=new Map([...host.querySelectorAll('[data-msg-id]')].map(n=>[n.dataset.msgId,n]));
    host.querySelector('.agent-empty')?.remove();
    if (!s.msgs.length) {
      const empty = el(
        `<div class="agent-empty"><div class="ae-mark">${avatar(s,48)}</div><h3>和 ${esc(s.name)} 开始新对话</h3><p>描述你的想法，或 @ 指定助手与页面。</p></div>`,
      );
      host.appendChild(empty);
    }
    s.msgs.forEach((m,index) => {
      m.id ||= uid('msg');
      const a=mgr.sessions().find(a=>a.id===m.assistantId)||s;
      let b=existing.get(m.id);existing.delete(m.id);
      if(!b){
        b=el(`<article class="msg ${m.role==='user'?'user':'sys'}" data-msg-id="${esc(m.id)}">${m.role==='user'?'':`<div class="msg-author"><span>${avatar(a,24)}</span><b>${esc(a.name)}</b></div>`}<div class="msg-body"></div><div class="msg-actions"><button data-copy aria-label="复制消息">${icon('copy',14)}复制</button>${m.role==='user'?`<button data-edit>${icon('edit',14)}编辑</button>`:`<button data-retry>${icon('refresh',14)}重新生成</button>`}</div></article>`);
        b.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(m.text||'');toast('已复制','ok');}catch{toast('复制失败，请选择文字复制','err');}};
        b.querySelector('[data-edit]')?.addEventListener('click',()=>{
          if(isBusy(s.task)||b.querySelector('.msg-edit'))return;
          const edit=el('<form class="msg-edit"><textarea aria-label="编辑消息" rows="4"></textarea><small>将在新对话分支中重发，保留当前记录及已保存的页面。</small><div><button type="button" data-cancel>取消</button><button type="submit" class="btn primary small">保存并发送</button></div></form>');
          edit.querySelector('textarea').value=m.request?.text||m.text;
          edit.querySelector('[data-cancel]').onclick=()=>{edit.remove();b.classList.remove('is-editing');};
          edit.onsubmit=e=>{e.preventDefault();const text=edit.querySelector('textarea').value.trim();if(text)replay(s.msgs.indexOf(m),text);};
          b.classList.add('is-editing');b.append(edit);edit.querySelector('textarea').focus();
        });
        b.querySelector('[data-retry]')?.addEventListener('click',()=>{
          const userIndex=s.msgs.findLastIndex((x,i)=>i<s.msgs.indexOf(m)&&x.role==='user');if(userIndex>=0)replay(userIndex);
        });
      }
      const body=b.querySelector('.msg-body');if(body.textContent!==(m.text||''))body.textContent=m.text||'';
      b.querySelectorAll('[data-edit],[data-retry]').forEach(n=>n.disabled=isBusy(s.task)||sending);
      if(host.children[index]!==b)host.insertBefore(b,host.children[index]||null);
    });
    existing.forEach(n=>n.remove());
    paintResponse();
    if(atBottom)host.scrollTop = host.scrollHeight;
  }
  let sending=false,responseKey='';
  async function taskAction(action,extra={}){
    const projectId=app.project()?.id,conversationId=s.conversationId,task=s.task;if(!task)return;
    try{const updated=await app.api.taskAction(projectId,task.id,{action,...extra});
      if(app.project()?.id===projectId&&s.conversationId===conversationId){
        s.task=s.task?.id===updated.id&&s.task.updatedAt>updated.updatedAt?s.task:updated;
        if(action==='answer'){s.msgs.push({id:uid('msg'),role:'user',text:extra.answer});mgr.saveConversation(s);}
        paintMsgs();paintPickers();
      }
      return true;
    }catch{return false;/* API already displays the failure. */}
  }
  function paintResponse(){
    const t=s.task,host=q('.ag-msgs'),busy=isBusy(t)||sending;
    const key=JSON.stringify([t?.id,t?.status,t?.phase,t?.error,t?.question,t?.events?.at(-1),sending]);
    const sendButton=q('[data-a=send]');
    sendButton.innerHTML=icon(busy?'rect':'send',17);sendButton.setAttribute('aria-label',busy?'停止回复':'发送');sendButton.setAttribute('data-tip',busy?'停止回复':'发送');
    if(key===responseKey){const row=host.querySelector('.ag-response');if(row&&host.lastElementChild!==row)host.append(row);return;}responseKey=key;
    host.querySelector('.ag-response')?.remove();
    if(!t&&!sending||t?.status==='completed')return;
    const label=sending?'正在发送':t.status==='queued'?'等待回复':t.status==='running'?(t.model==='mcp:external'&&t.phase==='thinking'?'等待外部助手接管':{thinking:'正在思考',output:'正在输出',tool:'正在使用工具'}[t.phase]||'正在思考'):taskStatus(t);
    const replying=mgr.sessions().find(a=>a.id===(t?.assistantId||s.recipient))||s;
    const row=el(`<section class="ag-response"><div class="msg-author"><span class="${busy?'responding':''}">${avatar(replying,24)}</span><b>${esc(replying.name)}</b><span class="response-phase" role="status">${esc(label)}</span></div>${t?.error?`<p class="response-error">${esc(t.error)}</p>`:''}<div class="response-actions"></div><div class="response-question"></div></section>`);
    const actions=row.querySelector('.response-actions');
    const button=(label,fn)=>{const b=el(`<button class="btn small">${label}</button>`);b.onclick=fn;actions.append(b);};
    if(t&&!['completed','cancelled','failed','conflict','paused'].includes(t.status))button('停止回复',()=>taskAction('cancel'));
    if(t&&['paused','failed','conflict','cancelled'].includes(t.status)&&!t.question){
      button('继续回复',()=>taskAction('resume'));
      button('重新尝试',()=>{const i=s.msgs.findLastIndex(m=>m.role==='user'&&m.taskId===t.id);if(i>=0)replay(i);});
    }
    if(t?.question){
      const box=row.querySelector('.response-question');
      box.innerHTML=`<p>${esc(t.question.question)}</p><div></div><form><input required aria-label="补充回答" placeholder="输入你的回答"><button class="btn small" type="submit">回答</button></form>`;
      for(const option of t.question.options||[]){const b=el(`<button class="btn small">${esc(option)}</button>`);b.onclick=()=>taskAction('answer',{answer:option});box.querySelector('div').append(b);}
      box.querySelector('form').onsubmit=e=>{e.preventDefault();taskAction('answer',{answer:box.querySelector('input').value});};
    }
    host.append(row);
  }
  async function replay(index,text){
    if(isBusy(s.task)||sending)return;
    const m=s.msgs[index],request=m.request||{};
    const prefix=structuredClone(s.msgs.slice(0,index)).map(({taskId,...m})=>m);
    mgr.newConversation(s,{msgs:prefix,title:'重新编辑的对话'});
    s.mode=request.mode||s.mode;s.model=request.model||s.model;s.think=request.think||s.think;
    s.recipient=request.assistantId&&request.assistantId!==s.id?request.assistantId:null;
    s.refs=structuredClone(request.refs||[]);s.skill=request.skill||null;
    s.replayScope=request.scope||'all';
    q('[data-scope]').value=Array.isArray(request.scope)?'page':'all';
    q('[data-collab]').value=request.collaboration||'off';
    root.querySelectorAll('[data-mode-v]').forEach(b=>b.classList.toggle('on',b.dataset.modeV===s.mode));
    ta.value=text??request.text??m.text;paintChips();paintPickers();await send();
  }
  async function send() {
    if(sending)return;
    if(isBusy(s.task)){await taskAction('cancel');return;}
    let text = ta.value.trim();
    if (!text && !s.refs.length) return;
    if(s.task?.question&&['waiting_user','waiting_authorization'].includes(s.task.status)){
      if(text&&await taskAction('answer',{answer:text})){ta.value='';grow();mgr.saveConversation(s);}return;
    }
    const replying=mgr.sessions().find(a=>a.id===s.recipient)||s;
    const refs = describeRefs(app, s.refs);
    const skillIds = [...new Set([...replying.skills, ...(s.skill ? [s.skill] : [])])];
    const request = {
      text,
      assistantId:replying.id,
      prompt: replying.prompt,
      skills: skillIds,
      model: s.model,
      think: s.think,
      refs: structuredClone(s.refs),mode:s.mode,skill:s.skill,scope:s.replayScope||(q('[data-scope]').value==='page'&&app.state.page?[app.state.page]:'all'),collaboration:q('[data-collab]').value,
    };
    const projectId=app.project().id,conversationId=s.conversationId;
    const history=historyFor(s.msgs);
    sending=true;paintResponse();
    q("[data-a=send]").disabled = true;
    try {
      if ((await app.bus.flushMeta()) === false) return;
      const scope=request.scope;
      const task = await app.api.startTask(projectId, {
        requestId: uid("req"),
        assistantId: request.assistantId,
        conversationId,
        text: text || "请分析这些引用",
        skills: skillIds,
        model: request.model,
        think: request.think,
        refs: request.refs,
        mode: request.mode,
        collaboration: request.collaboration,
        scope,
        history,
      });
      const message={
        id:uid('msg'),
        role: "user",
        text: text + (refs.length ? "\n引用：" + refs.join("；") : ""),
        request,
        taskId: task.id,
      };
      const same=app.project()?.id===projectId&&s.conversationId===conversationId;
      if(!same){
        if(app.project()?.id===projectId){const c=mgr.conversationList().find(c=>c.id===conversationId);if(c){c.msgs.push(message);app.bus.saveMeta();}}
        return;
      }
      // SSE can beat the POST response; preserve the newer status and put the prompt before its answer.
      s.task=s.task?.id===task.id?s.task:task;
      const first=s.msgs.findIndex(m=>m.taskId===task.id);s.msgs.splice(first<0?s.msgs.length:first,0,message);
      ta.value = "";
      grow();
      s.refs = [];
      s.recipient=null;
      paintChips();
      paintMsgs();
      paintPickers();
      mgr.saveConversation(s);
    } catch { /* The API displays the error; the draft remains available. */
    } finally {
      sending=false;paintMsgs();
      s.replayScope=null;
      q("[data-a=send]").disabled = false;
    }
  }
  function focus() {
    setTimeout(() => ta.focus(), 40);
  }

  root.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-mode-v]");
    if (mode) {
      (async () => {
        s.mode = mode.dataset.modeV;
        if (s.task && !["completed", "cancelled"].includes(s.task.status))
          await app.api.taskAction(app.project().id, s.task.id, {
            action: "mode",
            mode: s.mode,
          });
        root
          .querySelectorAll("[data-mode-v]")
          .forEach((b) => b.classList.toggle("on", b.dataset.modeV === s.mode));
        mgr.saveConversation(s);
      })();
      return;
    }
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "send") send();
    if (a === "close") mgr.close(s);
    if (a === "manage") mgr.manage();
    if (a === "fold") mgr.fold(s);
    if (a === "new") mgr.newWindow(s);
    if (a === 'conversations') mgr.pickConversation(b,s);
    if (a === 'new-chat') mgr.newConversation(s);
    if (a === "switch") mgr.pickSession(b);
    if (a === "dock") mgr.toggleDock(s);
    if (a === "settings") app.openSettings();
    if (a === "clear") {
      s.msgs = [];
      s.refs = [];
      paintChips();
      paintMsgs();
      paintPickers();
      mgr.saveConversation(s);
    }
    if (a === "at") mention(b);
    if (a === "role")
      showMenu(
        ROLES.map((r) => ({
          label: r,
          checked: r === s.role,
          onClick: () => {
            s.role = r;
            paintPickers();
            mgr.saveProfiles();
          },
        })),
        0,
        0,
        { anchor: b, minWidth: 150 },
      );
    if (a === "think")
      showMenu(
        [
          { title: "思考强度" },
          ...THINK.map((t) => ({
            label: t.label,
            hint: t.hint,
            checked: t.id === s.think,
            onClick: async () => {
              try {
                if (s.task && !["completed", "cancelled"].includes(s.task.status)) {
                  await app.api.taskAction(app.project().id, s.task.id, { action: "think", think: t.id });
                }
              } catch { return; }
              s.think = t.id;
              mgr.saveProfiles();
              paintPickers();
            },
          })),
        ],
        0,
        0,
        { anchor: b, minWidth: 220 },
      );
    if (a === "model")
      mgr.modelMenu(b, s.model, (id) => {
        s.model = id;
        mgr.saveProfiles();
        paintPickers();
      });
    if (a === "skill")
      showMenu(
        [
          { title: "技能" },
          ...mgr.skills().map((k) => ({
            label: k.name,
            hint: k.desc,
            icon: k.icon,
            checked: s.skill === k.id,
            onClick: () => {
              s.skill = s.skill === k.id ? null : k.id;
              paintChips();
              mgr.saveConversation(s);
              focus();
            },
          })),
        ],
        0,
        0,
        { anchor: b, minWidth: 300 },
      );
    if (a === "plus") {
      const info = app.view() === "edit" && app.editor.selection;
      showMenu(
        [
          {
            label: "上传文件或图片",
            icon: "upload",
            hint: "参考图、截图、文档都可以",
            onClick: () => fileIpt.click(),
          },
          {
            label: "引用当前页面",
            icon: "file",
            disabled: !app.state.page,
            onClick: () =>
              addRef({
                kind: "page",
                page: app.state.page,
                title:
                  (
                    app
                      .project()
                      .pages.find((p) => p.file === app.state.page) || {}
                  ).title || app.state.page,
              }),
          },
          {
            label: info
              ? `引用选中元素 ${app.editor.describe(info)}`
              : "引用选中元素（先在编辑里选一个）",
            icon: "target",
            disabled: !info,
            onClick: () =>
              addRef({
                kind: "element",
                page: app.state.page,
                selector: info.selector,
                line: info.line,
                title: app.editor.describe(info),
              }),
          },
          {
            label: "@ 更多（页面、标记编号、颜色）…",
            icon: "at",
            onClick: () => mention(b),
          },
        ],
        0,
        0,
        { anchor: b, minWidth: 290 },
      );
    }
  });
  async function addFile(f) {
    if (s.refs.filter((r) => r.kind === "file").length >= MAX_ATTACHMENTS) {
      toast("一次最多 4 个参考文件", "err");
      return;
    }
    try { addRef(await readAttachment(f)); } catch(error) { toast(error.message,'err'); }
  }
  fileIpt.onchange = async () => {
    for (const f of fileIpt.files) await addFile(f);
    fileIpt.value = "";
  };
  root.addEventListener("dragover", (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
      e.preventDefault();
      root.classList.add("drop");
    }
  });
  root.addEventListener("dragleave", (e) => {
    if (!root.contains(e.relatedTarget)) root.classList.remove("drop");
  });
  root.addEventListener("drop", async (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    root.classList.remove("drop");
    for (const f of e.dataTransfer.files) await addFile(f);
  });

  Object.assign(s, {
    syncTasks(tasks) {
      const own = tasksForConversation(tasks,mgr.conversationList().find(c=>c.id===s.conversationId));
      s.task = own.at(-1) || null;
      let changed = false;
      for (const t of own) {
        if (t.output) {
          let m = s.msgs.find(
            (x) => x.role === "assistant" && x.taskId === t.id,
          );
          if (!m) {
            m = { id:uid('msg'),role: "assistant", assistantId:t.assistantId, taskId: t.id, text: t.output };
            s.msgs.push(m);
            changed = true;
          } else if (m.text !== t.output) {
            m.text = t.output;
            changed = true;
          }
        }
      }
      if (changed) {
        mgr.saveConversation(s);
      }
      paintMsgs();
      paintPickers();
    },
    send,
    addRef,
    focus,
    paintPickers,
    paintChips,
    conversation() {
      return {
        msgs: s.msgs,
        refs: s.refs.filter((r) => r.kind !== "file"),
        skill: s.skill,
        model:s.model,
        recipient:s.recipient,
        scope:q('[data-scope]').value,
        draft: ta.value,
        mode: s.mode,
        collaboration: q("[data-collab]").value,
      };
    },
    restore(data = {}) {
      s.conversationId=data.id||null;
      responseKey='';q('.ag-msgs').innerHTML='';
      s.msgs = Array.isArray(data.msgs) ? data.msgs : [];
      s.refs = Array.isArray(data.refs) ? data.refs : [];
      s.skill = data.skill || null;
      s.recipient=data.recipient||null;
      if(data.model)s.model=data.model;
      s.mode = data.mode === "create" ? "create" : "plan";
      q("[data-collab]").value = data.collaboration || "off";
      q('[data-scope]').value=data.scope==='page'?'page':'all';
      root
        .querySelectorAll("[data-mode-v]")
        .forEach((b) => b.classList.toggle("on", b.dataset.modeV === s.mode));
      s.task = null;
      ta.value = data.draft || "";
      paintChips();
      paintMsgs();
      paintPickers();
      grow();
    },
    prefill(text, o = {}) {
      ta.value = text;
      grow();
      if(o.model)s.model=o.model;
      if(Array.isArray(o.refs))s.refs=o.refs.map(r=>({id:uid('rf'),...r}));
      if (o.skill) s.skill = o.skill;
      paintPickers();
      paintChips();
      mgr.saveConversation(s);
      focus();
    },
    reset() {
      s.msgs = [];
      s.refs = [];
      s.skill = null;
      paintChips();
      paintMsgs();
    },
    blur() {
      if (root.contains(document.activeElement)) document.activeElement.blur();
    },
  });
  paintPickers();
  paintChips();
  paintMsgs();
  return s;
}
