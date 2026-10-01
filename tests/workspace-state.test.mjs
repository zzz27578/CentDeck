/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createBus } from '../app/js/core/bus.js';
import { inspectResponsiveSource } from '../app/js/shell/responsive-source.js';

const saved = [], writes = [];
let fail = false;
const project = {id:'test',tokens:{colors:{brand:'#123456'}},canvasNotes:[]};
const bus = createBus({api:{saveProject:async (id,p) => {if(fail) throw Error('offline');saved.push(structuredClone(p));},writeFile:async(id,file,text)=>writes.push({file,text})},onError:()=>{}});
bus.bindProject(()=>project);
await bus.doMeta({label:'便签',apply:()=>project.canvasNotes.push({id:'n1',text:'标题'}),revert:()=>project.canvasNotes.pop()});
await bus.undo(); assert.equal(project.canvasNotes.length,0);
await bus.redo(); assert.equal(project.canvasNotes.length,1);
project.tokens.colors.brand='#445566'; await bus.flushMeta();
assert.equal(writes.at(-1).file,'design/tokens.json');
assert.equal(saved.at(-1).tokens,undefined);
fail=true;
await assert.rejects(bus.doMeta({label:'失败写入',apply:()=>project.canvasNotes.push({id:'n2'}),revert:()=>project.canvasNotes.pop()}));
assert.equal(project.canvasNotes.length,1); assert.equal(bus.saveState,'error');
fail=false; await bus.flushMeta(); assert.equal(bus.saveState,'saved');

assert.equal(inspectResponsiveSource('<meta name="viewport" content="width=device-width">','@media(max-width:900px){main{padding:1rem}}').responsive,true);
assert.equal(inspectResponsiveSource('<div class="md:grid lg:flex">').responsive,true);
assert.equal(inspectResponsiveSource('<style>.grid{grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))}</style>').fluid,true);
assert.equal(inspectResponsiveSource('<h1>Desktop</h1>').responsive,false);
assert.equal(inspectResponsiveSource('<h1>Desktop</h1>').viewport,false);
console.log('工作台状态测试：撤销/重做、保存失败恢复、规范分文件保存及响应式检测通过');
