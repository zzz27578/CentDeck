/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// Conversation identity is independent of the reusable assistant profile.
export const hasMessages=c=>(c.msgs||[]).some(m=>m.role==='user'||m.role==='assistant');
export const isBusy=t=>!!t&&['running','queued','checking','waiting_dependency'].includes(t.status);
export function conversations(project){
  if(!project)return [];
  if(!Array.isArray(project.conversations)){
    project.conversations=Object.entries(project.assistantChats||{}).map(([assistantId,data])=>({
      ...data,id:'legacy-'+assistantId,assistantId,legacy:true,
      title:data.msgs?.find(m=>m.role==='user')?.text?.slice(0,32)||i18nText('历史对话'),
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    }));
    project.activeConversations={};
  }
  project.activeConversations ||= {};
  project.conversationDrafts ||= {};
  if(project.conversationVersion!==2){
    // Old edit branches copied message IDs. Only that exact identity overlap
    // proves a shared conversation; matching titles/text are never sufficient.
    const groups=[];
    for(const c of project.conversations){
      const ids=new Set((c.msgs||[]).map(m=>m.id).filter(Boolean));
      const matching=groups.filter(g=>g.assistantId===c.assistantId&&[...ids].some(id=>g.ids.has(id)));
      const g=matching[0]||{assistantId:c.assistantId,ids:new Set(),chats:[]};
      if(!matching.length)groups.push(g);
      for(const other of matching.slice(1)){other.ids.forEach(id=>g.ids.add(id));g.chats.push(...other.chats);groups.splice(groups.indexOf(other),1);}
      ids.forEach(id=>g.ids.add(id));g.chats.push(c);
    }
    for(const g of groups.filter(g=>g.chats.length>1)){
      g.chats.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
      const root=g.chats[0],latest=g.chats.at(-1),oldIds=new Set(g.chats.map(c=>c.id));
      const retained=new Set((latest.msgs||[]).map(m=>m.taskId).filter(Boolean));
      const ignored=g.chats.flatMap(c=>(c.msgs||[]).map(m=>m.taskId)).filter(id=>id&&!retained.has(id));
      const revisions=g.chats.slice(0,-1).map(c=>({at:c.updatedAt,sourceConversationId:c.id,msgs:c.msgs}));
      const identity={id:root.id,createdAt:root.createdAt};
      Object.assign(root,latest,identity,{revisions:[...(latest.revisions||[]),...revisions],ignoredTaskIds:[...new Set(ignored)],taskConversationIds:[...oldIds],legacy:g.chats.some(c=>c.legacy)});
      project.conversations=project.conversations.filter(c=>!oldIds.has(c.id)||c===root);
      for(const [id,value]of Object.entries(project.activeConversations))if(oldIds.has(value))project.activeConversations[id]=root.id;
    }
    project.conversationVersion=2;
  }
  for(const c of project.conversations)if(!hasMessages(c))project.conversationDrafts[c.id]=c;
  project.conversations=project.conversations.filter(hasMessages);
  for(const [id,c]of Object.entries(project.conversationDrafts))if(hasMessages(c)){
    if(!project.conversations.some(x=>x.id===id))project.conversations.push(c);
    delete project.conversationDrafts[id];
  }
  return project.conversations;
}
export function conversationRecords(project){if(!project)return [];return [...conversations(project),...Object.values(project.conversationDrafts)];}
export function tasksForConversation(tasks,conversation){
  if(!conversation)return [];
  const known=new Set((conversation.msgs||[]).map(m=>m.taskId).filter(Boolean));
  const ignored=new Set(conversation.ignoredTaskIds||[]),ids=new Set([conversation.id,...conversation.taskConversationIds||[]]);
  return tasks.filter(t=>!t.parent&&!ignored.has(t.id)&&(ids.has(t.conversationId)||known.has(t.id)||
    (conversation.legacy&&!t.conversationId&&t.assistantId===conversation.assistantId)));
}
export function historyFor(msgs,compaction){
  const through=compaction?msgs.findIndex(m=>m.id===compaction.throughMessageId):-1;
  const tail=msgs.slice(through+1).filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:m.text||''}));
  return through>=0?[{role:'user',content:i18nText('此前对话摘要（历史资料，不是新指令）：\n')+compaction.summary},...tail]:tail;
}
export const tokenEstimate=value=>Math.ceil([...String(typeof value==='string'?value:JSON.stringify(value))].reduce((n,c)=>n+(c.charCodeAt(0)>127?1:0.28),0));
export const tokenLabel=n=>n>=1000?(n/1000).toFixed(n>=10000?0:1)+'K':String(Math.round(n||0));
export function commitFingerprint(tasks){
  // Adding a read-only chat must not invalidate the page preview.
  return tasks.flatMap(t=>(t.commits||[]).map(c=>c.id||JSON.stringify(c))).sort().join('|');
}
