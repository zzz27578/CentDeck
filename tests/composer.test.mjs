/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {readAttachment,MAX_ATTACHMENTS} from '../app/js/agent/attachments.js';
import {availableModels,resolveModel,attachmentModelIssue} from '../app/js/agent/model-options.js';
import {PRESETS} from '../app/js/panels/style-presets.js';
const text=await readAttachment(new File(['设计一张手机页面'],'brief.md',{type:'text/markdown'}));
assert.equal(text.text,'设计一张手机页面');assert.equal(text.kind,'file');
const bytes=new Uint8Array([137,80,78,71,0,1,255]);
const image=await readAttachment(new File([bytes],'reference.png',{type:'image/png'}));
assert.equal(image.media,'image');assert.deepEqual(Buffer.from(image.url.split(',')[1],'base64'),Buffer.from(bytes));
const audio=await readAttachment(new File([bytes],'sample.wav'));assert.equal(audio.media,'audio');
await assert.rejects(readAttachment(new File(['%PDF'],'brief.pdf')),/支持/);
await assert.rejects(readAttachment(new File(['x'.repeat(128001)],'large.txt')),/128 KB/);
await assert.rejects(readAttachment(new File([new Uint8Array(4*1024*1024+1)],'huge.png',{type:'image/png'})),/4 MB/);
assert.equal(MAX_ATTACHMENTS,4);
const settings={defaultModel:'active:visual',providers:[{id:'off',enabled:false,models:['hidden']},{id:'active',name:'Test',enabled:true,models:['visual','text'],modelCapabilities:{visual:{vision:true,audio:true},text:{vision:false}}}]};
assert.deepEqual(availableModels(settings).map(m=>m.id),['active:visual','active:text']);
assert.equal(resolveModel(settings,'auto').id,'active:visual');assert.equal(attachmentModelIssue(resolveModel(settings,'auto'),[image,audio]),null);
assert.match(attachmentModelIssue(resolveModel(settings,'active:text'),[image]),/图像/);
assert.match(attachmentModelIssue(null,[text]),/选择模型/);
assert.equal(attachmentModelIssue(resolveModel(settings,'mcp:external'),[text]),null);
assert.equal(resolveModel(settings,'removed:old'),null);
const luminance=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
assert.equal(Object.keys(PRESETS).length,6);
for(const [name,preset] of Object.entries(PRESETS)){
  assert(contrast(preset.colors.text,preset.colors.bg)>=4.5,name+' body contrast');
  assert(contrast(preset.colors.muted,preset.colors.bg)>=4.5,name+' secondary text contrast');
  for(const key of ['fontSizes','spacing','radius'])assert(preset[key].every(v=>/^\d+px$/.test(v)));
}
console.log('Composer: real attachment payloads/limits, model capability checks and six preset contrast checks passed');
