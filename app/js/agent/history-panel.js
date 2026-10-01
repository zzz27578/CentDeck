import {el,esc,confirmDlg,promptDlg,toast} from '../core/ui.js';
import {icon} from '../core/icons.js';
import {conversations,tasksForConversation} from './conversations.js';
import {avatar} from './studio.js';

export function mountHistory(app,host,close){
  let disposed=false,groups=[],expanded=new Set([app.project()?.id]);
  host.innerHTML='<div class="history-toolbar"><input class="ipt" aria-label="搜索对话历史" placeholder="搜索项目、对话或消息"><button class="btn primary" data-new-chat>新对话</button></div><div class="history-list"><p>正在读取历史…</p></div>';
  host.querySelector('[data-new-chat]').disabled=!app.project();
  host.querySelector('[data-new-chat]').onclick=async()=>{await close();app.agent.newWindow();};
  const time=c=>new Date(c.updatedAt).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  async function record(group,c){const project=group.id===app.project()?.id?app.project():await app.api.getProject(group.id);return {project,chat:conversations(project).find(x=>x.id===c.id)};}
  async function open(group,c,floating){await close();if(app.project()?.id!==group.id)await app.openProject(group.id);if(app.project()?.id!==group.id)return;const chat=conversations(app.project()).find(x=>x.id===c.id);if(chat)app.agent.manager.openConversation(chat,floating);}
  function paint(){
    if(disposed)return;
    const query=host.querySelector('input').value.trim().toLowerCase(),list=host.querySelector('.history-list');list.innerHTML='';
    for(const group of groups){
      const chats=group.conversations.filter(c=>[group.name,c.title,c.search,app.agent.manager.sessions().find(a=>a.id===c.assistantId)?.name].join(' ').toLowerCase().includes(query));
      if(query&&!chats.length&&!group.name.toLowerCase().includes(query))continue;
      const section=el(`<details class="history-project" data-project="${esc(group.id)}" ${expanded.has(group.id)||query?'open':''}><summary>${icon('layers',17)}<b>${esc(group.name)}</b><small>${chats.length} 段对话</small>${icon('chevDown',14)}</summary><div class="history-project-chats"></div></details>`);
      section.addEventListener('toggle',()=>{if(section.open)expanded.add(group.id);else expanded.delete(group.id);});
      const rows=section.querySelector('.history-project-chats');
      for(const c of [...chats].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))){
        const a=app.agent.manager.sessions().find(a=>a.id===c.assistantId)||{name:'已删除的助手'};
        const row=el(`<article class="history-card"><span class="history-avatar">${avatar(a,30)}</span><div><h2>${esc(c.title)}</h2><p>${esc(c.preview)}</p><small>${esc(a.name)} · ${time(c)}</small></div><footer><button class="btn small" data-open>继续对话</button><button class="icon-btn" data-float aria-label="独立窗口打开" data-tip="独立窗口打开">${icon('undock',16)}</button><button class="icon-btn" data-rename aria-label="重命名对话" data-tip="重命名">${icon('edit',16)}</button><button class="icon-btn danger" data-delete aria-label="删除对话" data-tip="删除对话">${icon('trash',16)}</button></footer></article>`);
        row.querySelector('[data-open]').onclick=()=>open(group,c,false);row.querySelector('[data-float]').onclick=()=>open(group,c,true);
        row.querySelector('[data-rename]').onclick=async()=>{
          try{const {project,chat}=await record(group,c);if(!chat)return;
            if(project.id===app.project()?.id)await app.agent.manager.renameConversation(chat);
            else {const title=await promptDlg({title:'重命名对话',label:'对话名称',value:chat.title});if(!title)return;chat.title=title.slice(0,80);chat.named=true;await app.api.saveProject(project.id,project);}
            await reload();
          }catch(e){toast(e.message,'err');}
        };
        row.querySelector('[data-delete]').onclick=async()=>{
          try{const {project,chat}=await record(group,c);if(!chat)return;
            if(project.id===app.project()?.id)await app.agent.manager.deleteConversation(chat);
            else {if(!await confirmDlg({title:'删除对话',body:`删除「${esc(chat.title)}」并停止未完成的回复？已保存的网页修改保留。`,okLabel:'删除',danger:true}))return;
              for(const t of tasksForConversation(await app.api.tasks(project.id),chat).filter(t=>!['completed','cancelled'].includes(t.status)))await app.api.taskAction(project.id,t.id,{action:'cancel'});
              project.conversations=project.conversations.filter(x=>x.id!==chat.id);await app.api.saveProject(project.id,project);
            }await reload();
          }catch(e){toast(e.message,'err');}
        };rows.append(row);
      }
      if(!chats.length)rows.innerHTML='<p class="history-empty">这个项目还没有对话。</p>';list.append(section);
    }
    if(!list.children.length)list.innerHTML='<div class="studio-empty"><h2>暂无匹配的对话</h2></div>';
  }
  async function reload(){
    try{if(app.project()&&await app.bus.flushMeta()===false)return;groups=await app.api.chatGroups();if(!expanded.size&&groups.length)expanded.add(groups.find(g=>g.conversations.length)?.id||groups[0].id);paint();}
    catch(e){if(!disposed)host.querySelector('.history-list').textContent=e.message;}
  }
  let timer;
  const off=app.bus.on('tasks',()=>{clearTimeout(timer);timer=setTimeout(reload,500);});
  host.querySelector('input').oninput=paint;reload();
  return ()=>{disposed=true;clearTimeout(timer);off();};
}
