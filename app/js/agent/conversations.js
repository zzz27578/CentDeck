// Conversation identity is independent of the reusable assistant profile.
export const HISTORY_LIMIT=12;
export const isBusy=t=>!!t&&['running','queued','checking','waiting_dependency'].includes(t.status);
export function conversations(project){
  if(!project)return [];
  if(!Array.isArray(project.conversations)){
    project.conversations=Object.entries(project.assistantChats||{}).map(([assistantId,data])=>({
      ...data,id:'legacy-'+assistantId,assistantId,legacy:true,
      title:data.msgs?.find(m=>m.role==='user')?.text?.slice(0,32)||'历史对话',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    }));
    project.activeConversations={};
  }
  project.activeConversations ||= {};
  return project.conversations;
}
export function tasksForConversation(tasks,conversation){
  if(!conversation)return [];
  const known=new Set((conversation.msgs||[]).map(m=>m.taskId).filter(Boolean));
  return tasks.filter(t=>!t.parent&&(t.conversationId===conversation.id||known.has(t.id)||
    (conversation.legacy&&!t.conversationId&&t.assistantId===conversation.assistantId)));
}
export function historyFor(msgs){
  return msgs.filter(m=>['user','assistant'].includes(m.role)).slice(-HISTORY_LIMIT).map(m=>({role:m.role,content:m.text||''}));
}
export function commitFingerprint(tasks){
  // Adding a read-only chat must not invalidate the page preview.
  return tasks.flatMap(t=>(t.commits||[]).map(c=>c.id||JSON.stringify(c))).sort().join('|');
}
