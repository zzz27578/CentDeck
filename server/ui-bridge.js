/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const crypto=require('node:crypto');
const {ApiError}=require('./store');
function createBridge({now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,retention=90000,timeout=15000}={}){
  const clients=new Map(),pending=new Map();
  function fail(id,status,message){const p=pending.get(id);if(!p)return;pending.delete(id);clearTimer(p.timer);const client=clients.get(p.clientId);if(client)client.queue=client.queue.filter(c=>c.id!==id);p.reject(new ApiError(status,message));}
  function purge(){for(const [id,c] of clients)if(now()-c.at>retention){for(const [pid,p]of pending)if(p.clientId===id)fail(pid,409,'CLIENT_OFFLINE：工作台已离线，请重新 ui_state');clients.delete(id);}}
  function heartbeat(b){
    if(typeof b.clientId!=='string'||!b.clientId||b.clientId.length>100||!b.state)throw new ApiError(400,'缺少页面客户端和状态');
    purge();const c=clients.get(b.clientId)||{queue:[]};
    if(c.documentId&&b.documentId&&c.documentId!==b.documentId){
      for(const [id,p]of pending)if(p.clientId===b.clientId)fail(id,409,'DOCUMENT_REPLACED：页面已刷新，旧操作未重放；请 ui_state 获取新控件后核对结果');
      c.queue=[];
    }
    Object.assign(c,{state:b.state,at:now(),documentId:b.documentId||null});clients.set(b.clientId,c);
    const commands=c.queue.splice(0);return {commands,serverTime:now()};
  }
  function snapshot(filter={}){
    purge();return [...clients].filter(([id,c])=>(!filter.clientId||filter.clientId===id)&&(!filter.projectId||c.state.projectId===filter.projectId)).map(([id,c])=>({...c.state,clientId:id,documentId:c.documentId,lastSeenMs:now()-c.at,connection:now()-c.at>15000?'background-delayed':'online'}));
  }
  function send(a){
    const list=snapshot({clientId:a.clientId,projectId:a.action==='open_project'?undefined:a.projectId});
    if(!list.length)throw new ApiError(409,a.clientId?'CLIENT_UNAVAILABLE：客户端已离线或不在目标项目，请 ui_state 重新选择':'请在浏览器打开并登录目标项目，再调用 ui_state');
    const focused=list.filter(c=>c.focused),selected=list.length===1?list[0]:focused.length===1?focused[0]:null;
    if(!selected)throw new ApiError(409,'AMBIGUOUS_CLIENT：存在多个工作台标签页，请传 ui_state 返回的 clientId');
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimer(()=>fail(id,408,'UI_TIMEOUT：页面未及时回执，结果未知；请将工作台置前并 ui_state 核对，不要直接重放写操作'),timeout);
      pending.set(id,{resolve,reject,timer,clientId:selected.clientId,documentId:selected.documentId});
      clients.get(selected.clientId).queue.push({...a,id,documentId:selected.documentId,expiresAt:now()+timeout});
    });
  }
  function complete(b){
    const p=pending.get(b.id);if(!p||p.clientId!==b.clientId||(p.documentId&&p.documentId!==b.documentId))return {ignored:true};
    clearTimer(p.timer);pending.delete(b.id);const state=b.result?.snapshot||b.result;
    if(state?.controls&&clients.has(b.clientId))Object.assign(clients.get(b.clientId),{state,at:now()});
    b.error?p.reject(new ApiError(400,b.error)):p.resolve(b.result);return {received:true};
  }
  return {heartbeat,snapshot,send,complete};
}
module.exports={...createBridge(),createBridge};
