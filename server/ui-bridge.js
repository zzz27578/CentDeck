'use strict';
const crypto=require('node:crypto');
const {ApiError}=require('./store');
const clients=new Map(), pending=new Map();
function heartbeat(b) {
  if(typeof b.clientId!=='string'||b.clientId.length>100)throw new ApiError(400,'缺少页面客户端');
  const c=clients.get(b.clientId)||{queue:[]};
  Object.assign(c,{state:b.state,at:Date.now()});clients.set(b.clientId,c);
  for(const [id,x] of clients)if(Date.now()-x.at>60000)clients.delete(id);
  const commands=c.queue.splice(0);return {commands};
}
function snapshot(){return [...clients].filter(([,c])=>Date.now()-c.at<15000).map(([id,c])=>({clientId:id,...c.state}));}
function send(a){
  const live=snapshot(); const selected=a.clientId?live.find(c=>c.clientId===a.clientId):live.find(c=>c.focused)||live[0];
  if(!selected)throw new ApiError(409,'请在浏览器打开并登录 CentDeck 工作台');
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);const c=clients.get(selected.clientId);if(c)c.queue=c.queue.filter(x=>x.id!==id);reject(new ApiError(408,'页面操作超时，请检查页面连接'));},12000);pending.set(id,{resolve,reject,timer,clientId:selected.clientId});clients.get(selected.clientId).queue.push({id,...a});});
}
function complete(b){const p=pending.get(b.id);if(!p||p.clientId!==b.clientId)return {ignored:true};clearTimeout(p.timer);pending.delete(b.id);const state=b.result?.snapshot||b.result;if(state?.controls&&clients.has(b.clientId))clients.get(b.clientId).state=state;b.error?p.reject(new ApiError(400,b.error)):p.resolve(b.result);return {received:true};}
module.exports={heartbeat,snapshot,send,complete};
