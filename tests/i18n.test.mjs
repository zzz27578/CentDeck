/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import assert from 'node:assert/strict';
const values=new Map();globalThis.localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
const {text,template,errorText,changeLanguage}=await import('../app/js/core/i18n.js');
assert.equal(text('设置'),'设置');values.set('cd.language','en');
assert.equal(text('设置'),'Settings');assert.equal(text('<button title="设置">设置</button>'),'<button title="Settings">Settings</button>');
assert.equal(template`<button aria-label="管理 ${'设置'}">${'设置'}</button>`,'<button aria-label="Manage 设置">设置</button>','interpolated user data remains unchanged');
assert.equal(template`助手 ${'用户名'}`,'Assistant 用户名');
assert.equal(text('<button data-key="设置">设置</button>'),'<button data-key="设置">Settings</button>','data keys remain stable');
assert.match(errorText('模型接口返回 401，请检查地址、密钥和模型权限'),/^Model endpoint returned 401/);
assert.match(errorText('文件已变化，请重新读取：中文文件.html'),/^File changed; read it again: 中文文件.html$/);
let assigned;globalThis.location={href:'http://localhost:8420/',assign:value=>assigned=value};
const app={project:()=>({id:'project-one'}),state:{page:'a.html'},view:()=> 'edit',bus:{flushMeta:async()=>false}};
assert.equal(await changeLanguage('zh-CN',app),false);assert.equal(values.get('cd.language'),'en');assert.equal(assigned,undefined);
app.bus.flushMeta=async()=>true;await changeLanguage('zh-CN',app);const route=new URL(assigned);assert.equal(route.searchParams.get('project'),'project-one');assert.equal(route.searchParams.get('page'),'a.html');assert.equal(route.searchParams.get('settings'),'general');
console.log('i18n: static UI, interpolation/data-key protection, parameterized errors, save-failure guard and route-preserving language changes passed');
