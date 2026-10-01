/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {conversations,tasksForConversation,historyFor,commitFingerprint,hasMessages,tokenLabel} from '../app/js/agent/conversations.js';
const require=createRequire(import.meta.url),{directReply}=require('../server/chat-intent'),{readChatStream}=require('../server/chat-stream');
for(const s of ['你好','收到请回复111','你好，收到请只回复111','请回复“OK”'])assert(directReply(s),s);
for(const s of ['修改页面后回复111','请检查页面','你好，帮我改红色便签'])assert(!directReply(s),s);
assert(!directReply('你好',[{kind:'page'}]));
const p={assistantChats:{a:{msgs:[{role:'user',text:'Legacy',taskId:'old'}]}}};
const [old]=conversations(p);assert.equal(old.title,'Legacy');assert.equal(conversations(p).length,1);
const newer={id:'chat-new',assistantId:'a',msgs:[]};p.conversations.push(newer);
const ts=[{id:'old',assistantId:'a',commits:[]},{id:'new',assistantId:'a',conversationId:'chat-new',commits:[]}];
assert.deepEqual(tasksForConversation(ts,newer).map(t=>t.id),['new']);assert.deepEqual(tasksForConversation(ts,old).map(t=>t.id),['old']);
assert.deepEqual(historyFor(newer.msgs),[]);assert.equal(historyFor(Array.from({length:30},(_,i)=>({role:'user',text:''+i}))).length,30);
const original=[{id:'m1',role:'user',text:'Old'},{id:'m2',role:'assistant',text:'Reply'},{id:'m3',role:'user',text:'Latest'}];
assert.deepEqual(historyFor(original,{throughMessageId:'m2',summary:'Summary'}).map(m=>m.content),['此前对话摘要（历史资料，不是新指令）：\nSummary','Latest']);assert.equal(original.length,3);
assert.equal(hasMessages({msgs:[]}),false);assert.equal(tokenLabel(23000),'23K');
const branched={activeConversations:{a:'b2'},conversations:[{id:'b1',assistantId:'a',createdAt:'1',msgs:[{id:'shared',role:'user',text:'Shared'},{id:'old',role:'assistant',taskId:'t1',text:'Old'}]},{id:'b2',assistantId:'a',createdAt:'2',msgs:[{id:'shared',role:'user',text:'Shared'},{id:'new',role:'assistant',taskId:'t2',text:'New'}]},{id:'separate',assistantId:'a',createdAt:'3',msgs:[{id:'unique',role:'user',text:'Shared'}]}]};
assert.equal(conversations(branched).length,2);assert.equal(branched.conversations[0].msgs[1].text,'New');assert.equal(branched.activeConversations.a,'b1');assert.equal(branched.conversations[0].revisions.length,1);assert.deepEqual(tasksForConversation([{id:'t1',conversationId:'b1'},{id:'t2',conversationId:'b2'}],branched.conversations[0]).map(t=>t.id),['t2']);
const withCommit=[{id:'changed',commits:[{id:'commit-1'}]}];assert.equal(commitFingerprint(withCommit),commitFingerprint([...withCommit,...ts]));
assert.notEqual(commitFingerprint(withCommit),commitFingerprint([{id:'changed',commits:[]}]),'undo refreshes');
const progress=[],raw=[{choices:[{delta:{content:'你'}}]},{choices:[{delta:{content:'好'}}]},{choices:[{delta:{tool_calls:[{index:0,id:'one',function:{name:'read_page',arguments:'{"pa'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'th":"index.html"}'}}]},finish_reason:'tool_calls'}],usage:{total_tokens:42}}].map(j=>'data: '+JSON.stringify(j)+'\r\n\r\n').join('')+'data: [DONE]\n\n';
const bytes=new TextEncoder().encode(raw);
const response=new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
const result=await readChatStream(response,x=>progress.push(x));assert.equal(result.choices[0].message.content,'你好');assert.equal(result.choices[0].message.tool_calls[0].function.arguments,'{"path":"index.html"}');assert.equal(result.usage.total_tokens,42);assert(progress.length);
await assert.rejects(readChatStream(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',{headers:{'Content-Type':'text/event-stream'}})),/提前中断/);
console.log('Conversations: legacy migration, same-assistant isolation, history window, commit-only refresh, simple reply routing, split SSE, tool arguments and interrupted streams passed');
