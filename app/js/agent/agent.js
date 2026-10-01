// 助手管理：右侧停靠的主窗口 + 任意多个悬浮窗口（多助手协作的壳）。
// 拖标题栏就能把停靠的助手拽出来变成悬浮窗；把悬浮窗拖到屏幕最右边松手就停靠回去。
// 右键 @、框选、导入体检等处的引用和提示词，会送到你最近用过的那个助手窗口。
import { el, esc, uid, showMenu, toast, confirmDlg, promptDlg } from "../core/ui.js";
import { icon } from '../core/icons.js';
import { createSession } from "./session.js";
import { avatar } from './studio.js';
import { openAssistantManager } from "./manager.js";
import { userSkills, selectedUserSkill } from '../core/skill-catalog.js';
import { conversations, tasksForConversation, commitFingerprint } from './conversations.js';

export function createAgent(app) {
  let dockHost = null,
    dockInner = null,
    docked = null,
    active = null;
  let open = localStorage.getItem("cd.agentOpen") === "1";
  let width = +localStorage.getItem("cd.agentW") || 400;
  let skills = [],
    settings = null,
    seq = 1;
  const floats = new Map(); // session → 窗口元素
  const sessions = [];
  const extraWindows=[];
  const windows=()=>[...sessions,...extraWindows];
  let closePicker=()=>{};
  let pickerAnchor=null;

  const loadSkills = () => app.api.extension('skills').then(catalog=>{
    skills=userSkills(catalog,true);
    windows().forEach(s=>{s.paintPickers();s.paintChips();});
  }).catch(()=>{});
  const skillsReady=loadSkills();
  app.bus.on('skills',loadSkills);
  const loadSettings = () =>
    app.api
      .getSettings({ toast: false })
      .then((x) => {
        settings = x;
        windows().forEach((s) => s.paintPickers());
      })
      .catch(() => {});
  loadSettings();
  app.bus.on("settings", loadSettings);

  function newSession(opts = {}) {
    const s = createSession(app, mgr, { name: `助手 ${seq}`, ...opts });
    seq++;
    sessions.push(s);
    if (app.project()) restoreConversation(s);
    return s;
  }

  function createConversation(s,data={}){
    const p=app.project();if(!p)return null;
    const c={id:uid('chat'),assistantId:s.id,title:'新对话',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),msgs:[],refs:[],mode:s.mode,...data};
    conversations(p).push(c);app.bus.saveMeta();return c;
  }
  function restoreConversation(s,c){
    const p=app.project();if(!p){s.restore();return;}
    const list=conversations(p);
    c ||= list.find(x=>x.id===s.conversationId&&x.assistantId===s.id)
      ||list.find(x=>x.id===p.activeConversations[s.id]&&x.assistantId===s.id)
      ||list.find(x=>x.assistantId===s.id)||createConversation(s);
    p.activeConversations[s.id]=c.id;
    s.restore(c);s.syncTasks(taskList);
  }
  function openConversation(c,from,floating=false){
    const existing=windows().find(s=>s.conversationId===c.id);
    if(existing){
      if(floating){if(existing===docked)undock(existing);}
      else if(existing!==docked){if(docked){docked.root.remove();docked=null;}dock(existing);}
      show(existing);return existing;
    }
    let s=from;
    const base=sessions.find(x=>x.id===c.assistantId);
    if(!base){toast('此对话的助手配置已删除','err');return;}
    if(floating){s=createSession(app,mgr,{...profile(base)});extraWindows.push(s);}
    else if(!s||s.id!==c.assistantId){s=base;if(docked&&docked!==s){docked.root.remove();docked=null;}dock(s);}
    if(s.conversationId)mgr.saveConversation(s);
    restoreConversation(s,c);show(s);return s;
  }

  // ---------- 停靠区 ----------
  async function mount(host) {
    await ready;
    dockHost = host;
    host.style.setProperty("--agent-w", width + "px");
    host.innerHTML =
      '<div class="agent-inner"><div class="agent-resize" data-tip="拖动改宽度" data-tip-place="left"></div></div>';
    dockInner = host.firstElementChild;
    dockInner.firstElementChild.addEventListener("pointerdown", resizeDock);
    if (!docked && !floats.size && sessions.length) docked = sessions[0];
    if (docked) dockInner.appendChild(docked.root);
    floats.forEach((w) => document.body.appendChild(w));
    setOpen(open && !!docked, false);
  }
  function resizeDock(e) {
    e.preventDefault();
    const sx = e.clientX,
      w0 = width;
    dockHost.classList.add("resizing");
    const mv = (ev) => {
      width = Math.max(320, Math.min(760, w0 + sx - ev.clientX));
      dockHost.style.setProperty("--agent-w", width + "px");
    };
    const up = () => {
      dockHost.classList.remove("resizing");
      localStorage.setItem("cd.agentW", width);
      window.removeEventListener("pointermove", mv, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", mv, true);
    window.addEventListener("pointerup", up, true);
  }
  function setOpen(v, save = true) {
    open = v;
    if (dockHost) dockHost.classList.toggle("open", v);
    const b = document.getElementById("tb-agent");
    if (b)
      b.classList.toggle(
        "on",
        v || [...floats.values()].some((w) => !w.hidden),
      );
    if (save) localStorage.setItem("cd.agentOpen", v ? "1" : "0");
    if (v && docked) {
      active = docked;
      docked.focus();
    } else if (docked) docked.blur();
  }

  // ---------- 悬浮窗 ----------
  function floatWin(s, r) {
    const w = el(
      `<div class="agent-float"><div class="af-body"></div><i class="af-resize" data-tip="拖动改大小"></i></div>`,
    );
    const box = r || {
      x: innerWidth - width - 60,
      y: 90,
      w: width,
      h: Math.min(640, innerHeight - 170),
    };
    Object.assign(w.style, {
      left: box.x + "px",
      top: box.y + "px",
      width: box.w + "px",
      height: box.h + "px",
    });
    w.firstElementChild.appendChild(s.root);
    w.querySelector(".af-resize").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const sx = e.clientX,
        sy = e.clientY,
        w0 = w.offsetWidth,
        h0 = w.offsetHeight;
      const mv = (ev) => {
        w.style.width = Math.max(320, w0 + ev.clientX - sx) + "px";
        w.style.height = Math.max(300, h0 + ev.clientY - sy) + "px";
      };
      const up = () => {
        window.removeEventListener("pointermove", mv, true);
        window.removeEventListener("pointerup", up, true);
      };
      window.addEventListener("pointermove", mv, true);
      window.addEventListener("pointerup", up, true);
    });
    document.body.appendChild(w);
    floats.set(s, w);
    return w;
  }
  function undock(s, at) {
    if (docked !== s) return;
    docked = null;
    setOpen(false);
    floatWin(s, at);
    s.paintPickers();
  }
  function dock(s) {
    const w = floats.get(s);
    const r = w ? w.getBoundingClientRect() : null;
    if (w) {
      w.remove();
      floats.delete(s);
    }
    if (docked && docked !== s) {
      const prev = docked;
      docked = null;
      floatWin(prev, r && { x: r.left, y: r.top, w: r.width, h: r.height });
      prev.paintPickers();
    }
    docked = s;
    dockInner.appendChild(s.root);
    s.paintPickers();
    setOpen(true);
  }

  // 拖标题栏：停靠的拽出来变悬浮；悬浮的拖到最右边停靠
  document.addEventListener("pointerdown", (e) => {
    const head=e.target.closest?.('.ag-head'), compact=e.target.closest?.('.agent-float.collapsed');
    if(e.button!==0||(!head&&!compact)||e.target.closest('input,textarea,select,a,.af-resize')||e.target.closest('button:not(.ag-summary)'))return;
    const s=windows().find(x=>compact?floats.get(x)===compact:x.root.contains(head));
    if (!s) return;
    mgr.setActive(s);
    let sx = e.clientX, sy = e.clientY, moved=false;
    let w = floats.get(s),
      ox = w ? w.offsetLeft : 0,
      oy = w ? w.offsetTop : 0,
      hint = null;
    const mv = (ev) => {
      if(!moved&&Math.hypot(ev.clientX-sx,ev.clientY-sy)<(w?5:24))return;
      if(!moved){moved=true;closePicker();}
      ev.preventDefault();
      if (!w) {
        undock(s, {
          x: ev.clientX - 120,
          y: ev.clientY - 20,
          w: Math.min(width, 440),
          h: Math.min(620, innerHeight - 160),
        });
        w = floats.get(s);
        ox = w.offsetLeft;
        oy = w.offsetTop;
        sx=ev.clientX;sy=ev.clientY;
      }
      w.style.left =
        Math.max(
          0,
          Math.min(Math.max(0, innerWidth - w.offsetWidth), ox + ev.clientX - sx),
        ) + "px";
      w.style.top =
        Math.max(0, Math.min(Math.max(0,innerHeight-w.offsetHeight), oy + ev.clientY - sy)) + "px";
      const near = ev.clientX > innerWidth - 40 && !!app.state.project;
      if (near && !hint) {
        hint = el(
          '<div class="agent-dock-hint"><span>松手停靠到右侧</span></div>',
        );
        document.body.appendChild(hint);
      }
      if (!near && hint) {
        hint.remove();
        hint = null;
      }
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", mv, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener('pointercancel',up,true);
      if(moved){
        const suppress=event=>{event.preventDefault();event.stopImmediatePropagation();};
        document.addEventListener('click',suppress,true);
        setTimeout(()=>document.removeEventListener('click',suppress,true),0);
      }
      if (hint) {
        hint.remove();
        if(ev.type!=='pointercancel')dock(s);
      }
    };
    window.addEventListener("pointermove", mv, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener('pointercancel',up,true);
  });

  // ---------- 给会话用的接口 ----------
  const target = () =>
    active && windows().includes(active) ? active : docked || sessions[0];
  function show(s) {
    if (!s) return;
    if (s === docked) setOpen(true);
    else {
      let w = floats.get(s);
      if (!w) w = floatWin(s);
      w.hidden = false;
      w.classList.remove("collapsed");
    }
    active = s;
    s.focus();
  }
  const mgr = {
    async createProfile(profile) {
      const s = newSession(profile);
      try {
        await saveProfiles();
        return s;
      } catch (e) {
        sessions.splice(sessions.indexOf(s), 1);
        throw e;
      }
    },
    setActive(s) {
      active = s;
      windows().forEach((x) =>
        x.root.classList.toggle("active", x === s && sessions.length > 1),
      );
    },
    isDocked: (s) => s === docked,
    toggleDock: (s) => (s === docked ? undock(s) : dock(s)),
    newWindow(base=target()) {
      if(!base){base=newSession();saveProfiles();}
      const s=createSession(app,mgr,profile(base));extraWindows.push(s);
      if(app.project())restoreConversation(s,createConversation(s));
      const n = floats.size;
      floatWin(s, {
        x: Math.max(20, innerWidth - width - 100 - n * 28),
        y: 110 + n * 28,
        w: Math.min(width, 440),
        h: Math.min(600, innerHeight - 200),
      });
      mgr.setActive(s);
      s.focus();
      return s;
    },
    newConversation(s,data={}){
      mgr.saveConversation(s);
      const c=createConversation(s,data);if(!c)return;
      restoreConversation(s,c);mgr.saveConversation(s);s.focus();return c;
    },
    conversationList:()=>conversations(app.project()),
    async renameConversation(c){
      const title=await promptDlg({title:'重命名对话',label:'对话名称',value:c.title});
      if(title?.trim()){c.title=title.trim().slice(0,80);c.named=true;app.bus.saveMeta();windows().forEach(w=>w.paintPickers());}
    },
    async deleteConversation(c){
      if(!await confirmDlg({title:'删除对话',body:'删除这段聊天记录，并停止其中仍在运行的回复。已保存的网页修改会保留。',okLabel:'删除',danger:true}))return false;
      const p=app.project();
      for(const t of tasksForConversation(taskList,c).filter(t=>!['completed','cancelled'].includes(t.status)))await app.api.taskAction(p.id,t.id,{action:'cancel'});
      p.conversations=p.conversations.filter(x=>x.id!==c.id);
      for(const w of windows().filter(w=>w.conversationId===c.id)){w.conversationId=null;restoreConversation(w);}
      app.bus.saveMeta();return true;
    },
    pickConversation(anchor,s){
      if(pickerAnchor===anchor){closePicker();return;}closePicker();
      pickerAnchor=anchor;anchor.setAttribute('aria-expanded','true');
      const menu=el(`<div class="assistant-picker conversation-picker" role="dialog" aria-label="项目对话"><header><b>项目对话</b><button class="btn small" data-create>${icon('plus',14)}新对话</button></header><div class="conversation-list"></div><p>每段对话独立保存上下文，可同时打开多个窗口。</p></div>`);
      const list=menu.querySelector('.conversation-list');
      for(const c of [...conversations(app.project())].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))){
        const a=sessions.find(x=>x.id===c.assistantId);
        const row=el(`<div class="conversation-row ${c.id===s.conversationId?'on':''}"><button data-open><b>${esc(c.title)}</b><small>${esc(a?.name||'已删除的助手')} · ${new Date(c.updatedAt).toLocaleDateString('zh-CN')}</small></button><button class="icon-btn sm" data-more aria-label="管理 ${esc(c.title)}">${icon('more',16)}</button></div>`);
        row.querySelector('[data-open]').onclick=()=>{closePicker();openConversation(c,s);};
        row.querySelector('[data-more]').onclick=e=>showMenu([
          {label:'在独立窗口打开',icon:'undock',onClick:()=>{closePicker();openConversation(c,null,true);}},
          {label:'重命名',icon:'edit',onClick:async()=>{closePicker();await mgr.renameConversation(c);}},
          {label:'删除对话',icon:'trash',danger:true,onClick:async()=>{closePicker();await mgr.deleteConversation(c);}},
        ],0,0,{anchor:e.currentTarget});list.append(row);
      }
      menu.querySelector('[data-create]').onclick=()=>{closePicker();mgr.newConversation(s);};
      document.body.append(menu);const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-340,r.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+8))+'px';
      const outside=e=>{if(!menu.contains(e.target)&&!anchor.contains(e.target)&&!e.target.closest('.menu'))closePicker();};
      const key=e=>{if(e.key==='Escape'){closePicker();anchor.focus();}};
      closePicker=()=>{menu.remove();pickerAnchor=null;anchor.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);};
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);
    },
    close(s) {
      closePicker();
      s.blur();
      if (s === docked) setOpen(false);
      else {
        const w = floats.get(s);
        if (w) w.hidden = true;
      }
      if (active === s) active = null;
    },
    fold(s) {
      closePicker();
      if (s === docked) undock(s);
      const w = floats.get(s);
      if (!w) return;
      w.classList.toggle("collapsed");
      s.paintPickers();
      if (!w.classList.contains("collapsed")) s.focus();
    },
    pickSession(anchor, floating=false) {
      if(pickerAnchor===anchor){closePicker();return;}
      closePicker();
      pickerAnchor=anchor;anchor.setAttribute('aria-expanded','true');anchor.setAttribute('aria-haspopup','dialog');
      const menu=el(`<div class="assistant-picker" role="dialog" aria-label="选择助手"><header>${floating?'在悬浮窗打开':'选择助手'}</header><div class="assistant-picker-list"></div><button class="btn block" data-manage>${icon('plus',15)}新建或管理助手</button></div>`);
      const choose=(s,float)=>{closePicker();if(float){mgr.newWindow(s);return;}else{if(docked&&docked!==s){docked.root.remove();docked=null;}dock(s);}mgr.setActive(s);};
      for(const s of sessions){
        const row=el(`<div class="assistant-picker-row"><i class="picker-avatar">${avatar(s,28)}</i><span><b>${esc(s.name)}</b><small>${esc(s.role)}</small></span><button class="btn small" data-switch>${s===docked?'当前':'切换'}</button><button class="icon-btn" data-float aria-label="在悬浮窗打开 ${esc(s.name)}">${icon('plus',17)}</button></div>`);
        row.querySelector('[data-switch]').onclick=()=>choose(s,false);row.querySelector('[data-float]').onclick=()=>choose(s,true);menu.querySelector('.assistant-picker-list').append(row);
      }
      menu.querySelector('[data-manage]').onclick=()=>{closePicker();mgr.manage();};document.body.append(menu);
      const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-320,r.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+8))+'px';
      const outside=e=>{if(!menu.contains(e.target)&&!anchor.contains(e.target))closePicker();};
      const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePicker();anchor.focus();}};
      closePicker=()=>{menu.remove();anchor.setAttribute('aria-expanded','false');pickerAnchor=null;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);};
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);menu.querySelector('button')?.focus();
    },
    manage: () => openAssistantManager(mgr, app),
    sessions: () => sessions,
    openConversation:(c,floating=false)=>openConversation(c,target(),floating),
    show,
    visible: (s) =>
      s === docked ? open : !!floats.get(s) && !floats.get(s).hidden,
    async remove(s) {
      if (
        taskList.some(
          (t) =>
            t.assistantId === s.id &&
            [
              "running",
              "queued",
              "waiting_user",
              "waiting_dependency",
            ].includes(t.status),
        )
      ) {
        toast("请先停止这个助手的任务", "err");
        return;
      }
      const i = sessions.indexOf(s);
      if (i < 0) return;
      const remaining = sessions.filter((x) => x !== s);
      await saveProfileList(remaining);
      sessions.splice(i, 1);
      for(const w of extraWindows.filter(w=>w.id===s.id)){
        floats.get(w)?.remove();floats.delete(w);extraWindows.splice(extraWindows.indexOf(w),1);
        if(docked===w){w.root.remove();docked=null;setOpen(false);}if(active===w)active=null;
      }
      floats.get(s)?.remove();
      floats.delete(s);
      if (s === docked) {
        s.root.remove();
        docked = null;
        setOpen(false);
      }
      if (active === s) active = null;
    },
    saveProfiles,
    saveConversation(s) {
      const p = app.project();
      if (!p) return;
      const c=conversations(p).find(c=>c.id===s.conversationId);
      if(!c)return;
      Object.assign(c,s.conversation(),{updatedAt:new Date().toISOString()});
      if(!c.named&&c.msgs?.some(m=>m.role==='user'))c.title=c.msgs.find(m=>m.role==='user').text.slice(0,32);
      app.bus.saveMeta();
    },
    skills: () => skills,
    skill: (id) => selectedUserSkill(skills,id),
    modelLabel(id) {
      if (id === 'mcp:external' || (id === 'auto' && settings?.defaultModel === 'mcp:external')) return '外部 MCP 助手';
      if (id === "auto")
        return (
          settings?.defaultModel?.split(":").slice(1).join(":") || "默认模型"
        );
      return String(id).split(":").slice(1).join(":") || id;
    },
    modelMenu(anchor, cur, pick) {
      const items = [
        {label:'外部 MCP 助手（需连接接管）', checked:cur === 'mcp:external', onClick:() => pick('mcp:external')},
        {
          label: "默认模型",
          checked: cur === "auto",
          onClick: () => pick("auto"),
        },
      ];
      const on = settings
        ? settings.providers.filter((p) => p.enabled && p.models.length)
        : [];
      on.forEach((p) => {
        items.push({ title: p.name });
        p.models.forEach((m) =>
          items.push({
            label: m,
            checked: cur === `${p.id}:${m}`,
            onClick: () => pick(`${p.id}:${m}`),
          }),
        );
      });
      if (!on.length) items.push({ title: "还没有启用任何模型" });
      items.push("-", {
        label: "模型与接口设置…",
        icon: "settings",
        onClick: () => app.openSettings(),
      });
      showMenu(items, 0, 0, { anchor, minWidth: 260 });
    },
  };

  // ---------- 对外 ----------
  function toggle(force) {
    if (!sessions.length) {
      mgr.newWindow();
      return;
    }
    if (docked) {
      setOpen(force == null ? !open : !!force);
      return;
    }
    const anyShown = [...floats.values()].some((w) => !w.hidden);
    const want = force == null ? !anyShown : !!force;
    floats.forEach((w) => {
      w.hidden = !want;
    });
    setOpen(false, false);
  }
  let saveQueue = Promise.resolve();
  const profile = (s) =>
    Object.fromEntries(
      [
        "id",
        "name",
        "role",
        "avatar",
        "color",
        "prompt",
        "responsibility",
        "skills",
        "model",
        "think",
      ].map((k) => [k, s[k]]),
    );
  function saveProfileList(list) {
    const data = list.map(profile);
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => app.api.saveAssistants(data));
    return saveQueue;
  }
  function saveProfiles() {
    for(const w of extraWindows){const base=sessions.find(s=>s.id===w.id);if(base){for(const key of ['name','role','avatar','color','prompt','responsibility','skills'])w[key]=base[key];w.paintPickers();}}
    const p = saveProfileList(sessions);
    p.catch(() => toast("助手配置保存失败，请在管理页重试", "err"));
    return p;
  }
  const ready = Promise.all([app.api.getAssistants(),skillsReady])
    .then(([list]) => {
      list.forEach(newSession);
      docked = sessions[0] || null;
    })
    .catch(() => {
      toast("助手配置未加载，请刷新后重试", "err");
    });
  let source = null,
    sourceProject = null,
    taskList = [],
    commitKey = null;
  app.bus.on("project", () => {
    closePicker();
    const id = app.project()?.id;
    if (id === sourceProject) return;
    // Windows belong to one project. Close extra shells on project navigation;
    // their conversations remain in that project's archive.
    for(const w of extraWindows){floats.get(w)?.remove();floats.delete(w);w.root.remove();if(docked===w)docked=null;if(active===w)active=null;}
    extraWindows.length=0;
    if(!docked&&dockInner){docked=sessions.find(s=>!floats.has(s))||null;if(docked)dockInner.append(docked.root);}
    sessions.forEach(s=>{s.conversationId=null;});
    source?.close();
    sourceProject = id;
    taskList = [];
    commitKey = null;
    if (!id) { setOpen(false,false);floats.forEach(w=>w.hidden=true);return; }
    source = new EventSource(`/api/projects/${encodeURIComponent(id)}/events`);
    source.onmessage = (e) => {
      if (app.project()?.id !== id) return;
      try {
        taskList = JSON.parse(e.data);
        let backgroundChanged=false;
        const displayed=new Set(windows().map(s=>s.conversationId));
        for(const c of conversations(app.project()).filter(c=>!displayed.has(c.id))){
          for(const t of tasksForConversation(taskList,c))if(t.output){
            const m=c.msgs.find(m=>m.role==='assistant'&&m.taskId===t.id);
            if(m?.text===t.output)continue;
            if(m)m.text=t.output;
            else c.msgs.push({id:uid('msg'),role:'assistant',assistantId:t.assistantId,taskId:t.id,text:t.output});
            c.updatedAt=t.updatedAt;backgroundChanged=true;
          }
        }
        if(backgroundChanged)app.bus.saveMeta();
        windows().forEach((s) => s.syncTasks?.(taskList));
        app.bus.emit("tasks", taskList);
        const next = commitFingerprint(taskList);
        if (
          commitKey !== null &&
          next !== commitKey
        )
          app.bus.emit("ai-commit");
        commitKey = next;
      } catch (err) {
        console.error(err);
      }
    };
  });
  app.bus.on("project", () =>
    windows().forEach((s) => restoreConversation(s)),
  );

  return {
    mount,
    toggle,
    ready,
    manager: mgr,
    taskList: () => taskList,
    manage: mgr.manage,
    addRef(r) {
      const s = target() || mgr.newWindow();
      show(s);
      s.addRef(r);
    },
    prefill(text, o) {
      const s = target() || mgr.newWindow();
      show(s);
      s.prefill(text, o);
    },
    newWindow: () => mgr.newWindow(),
  };
}
