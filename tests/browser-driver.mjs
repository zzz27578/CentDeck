/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export async function browser(profile){
  const child=spawn(require('../server/capture').browserPath(),['--headless','--remote-debugging-pipe','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--user-data-dir='+profile],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
  let seq=0,buffer=Buffer.alloc(0);const pending=new Map(),errors=[];
  child.stdio[4].on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);let n;while((n=buffer.indexOf(0))>=0){const m=JSON.parse(buffer.subarray(0,n));buffer=buffer.subarray(n+1);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);}});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const call=(method,params)=>send(method,params,sessionId);
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
  const until=async(expression)=>{const deadline=Date.now()+20000;while(Date.now()<deadline){try{if(await evaluate(expression))return;}catch(error){if(!/navigated or closed|Cannot find context|Execution context was destroyed/.test(error.message))throw error;}await new Promise(r=>setTimeout(r,50));}let state;try{state=await evaluate('({url:location.href,readyState:document.readyState,title:document.title,text:document.body?.innerText.slice(0,900)})');}catch{}throw Error('Browser condition timed out: '+expression+'\n'+JSON.stringify(state)+'\n'+errors.join('\n'));};
  return {call,evaluate,until,errors,async close(){try{await send('Browser.close');}catch{}if(child.exitCode===null)child.kill();for(const p of pending.values())clearTimeout(p.timer);}};
}
