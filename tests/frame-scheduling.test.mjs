import assert from 'node:assert/strict';
import {afterPaint} from '../app/js/engine/frame.js';
const original={setTimeout,clearTimeout,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
let frame,timer,cancelledFrame=0,cancelledTimer=0,count=0;
globalThis.requestAnimationFrame=callback=>{frame=callback;return 1;};globalThis.cancelAnimationFrame=()=>cancelledFrame++;
globalThis.setTimeout=callback=>{timer=callback;return 2;};globalThis.clearTimeout=()=>cancelledTimer++;
try{
  afterPaint(()=>count++);frame();timer();assert.equal(count,1);assert(cancelledFrame&&cancelledTimer);
  afterPaint(()=>count++);timer();frame();assert.equal(count,2,'background timer completes rendering once even when animation frames are suspended');
  console.log('Frame scheduling: foreground paint and background fallback both complete exactly once');
}finally{Object.assign(globalThis,original);}
