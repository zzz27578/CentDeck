/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
// 服务端接口回归：node tests/api.test.mjs（会临时启动一个服务，结束后清理测试项目）
import { spawn } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 使用独立临时配置，不读写用户的密钥或助手设置。
const CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'centdeck-api-test-'));
fs.writeFileSync(path.join(CONFIG,'account.json'),JSON.stringify({username:'test',password:'test-only-centdeck',mustChange:false}));
let PORT = 8490;
const srv = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), CENTDECK_NO_OPEN: '1', CENTDECK_CONFIG_DIR: CONFIG, CENTDECK_PROJECTS_DIR:path.join(CONFIG,'projects') }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { srv.kill(); reject(new Error('测试服务启动超时')); }, 10000);
  srv.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/localhost:(\d+)/); if (match) { PORT = +match[1]; clearTimeout(timeout); resolve(); } });
  srv.once('error', err => { clearTimeout(timeout); reject(err); });
  srv.once('exit', code => { clearTimeout(timeout); reject(new Error('测试服务提前退出：' + code)); });
});
let cookie='';
const call = async (method, p, body) => {
  const res = await fetch(`http://localhost:${PORT}${p}`, { method, headers: { 'Content-Type': 'application/json','X-CentDeck':'1',Cookie:cookie }, body: body ? JSON.stringify(body) : undefined });
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  const j = await res.json();
  if (!j.ok) throw new Error(`${method} ${p}: ${j.error}`);
  return j.data;
};
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('  ✗', n); } };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const made = [];
try {
  await call('POST','/api/auth',{username:'test',password:'test-only-centdeck'});
  const blank = await call('POST', '/api/projects', { blank: true, name: 'api-test 空白' });
  made.push(blank.id);
  ok(blank.pages.length === 0 && blank.kind === 'blank', '空白项目没有页面');
  let proj = await call('POST', `/api/projects/${blank.id}/pages`, { title: 'Home' });
  ok(proj.pages.length === 1 && proj.pages[0].file === 'pages/home.html', '新建页面');
  const removed=await fetch(`http://localhost:${PORT}/api/projects/${blank.id}/reset`,{method:'POST',headers:{'X-CentDeck':'1',Cookie:cookie}});
  ok(removed.status===404&&(await call('GET',`/api/projects/${blank.id}`)).pages.length===1,'已移除的一键还原接口不能清空页面');

  const imp = await call('POST', '/api/import', { name: 'api-test 导入', files: [
    { path: 'my-site/index.html', dataBase64: b64('<!doctype html><title>我的首页</title><link rel="stylesheet" href="css/a.css"><h1>Hi</h1>') },
    { path: 'my-site/about/team.html', dataBase64: b64('<title>团队</title><p>x</p>') },
    { path: 'my-site/css/a.css', dataBase64: b64('h1{color:red}') },
    { path: 'my-site/node_modules/x/y.js', dataBase64: b64('skip') },
    { path: 'my-site/.DS_Store', dataBase64: b64('skip') },
  ] });
  made.push(imp.id);
  ok(imp.pages.length === 2 && imp.pages[0].file === 'index.html' && imp.pages[0].title === '我的首页', '导入：去掉外层文件夹、首页排第一、读出标题');
  const css = await fetch(`http://localhost:${PORT}/preview/${imp.id}/css/a.css`).then((r) => r.text());
  ok(css === 'h1{color:red}', '导入：相对路径的样式文件可访问');
  let bad = false;
  try { await call('POST', '/api/import', { files: [{ path: '../evil.html', dataBase64: b64('x') }] }); } catch { bad = true; }
  ok(bad, '导入：拒绝 .. 路径');

  const s1 = await call('PUT', '/api/settings', { providers: [{ id: 'deepseek', enabled: true, apiKey: 'sk-test-1234abcd' }] });
  const ds = s1.providers.find((p) => p.id === 'deepseek');
  ok(ds.hasKey && ds.keyHint === '••••abcd' && !JSON.stringify(s1).includes('sk-test'), '设置：密钥只返回末四位');
  const s2 = await call('PUT', '/api/settings', { providers: [{ id: 'deepseek', apiKey: null, enabled: false }] });
  ok(!s2.providers.find((p) => p.id === 'deepseek').hasKey, '设置：可以清除密钥');
  const assistants = [
    {id:'test-red',name:'红标设计师',role:'设计师',avatar:'palette',color:'#e5484d',prompt:'只处理红色标记',skills:['apply-marks'],model:'custom:test-model',think:'high'},
    {id:'test-blue',name:'蓝标审查员',role:'审查员',avatar:'check',color:'#3b82f6',prompt:'只处理蓝色标记',skills:[],model:'auto',think:'low'},
  ];
  await call('PUT','/api/assistants',assistants);
  const restored = await call('GET','/api/assistants');
  ok(restored.length === 2 && restored[0].prompt === assistants[0].prompt && restored[1].think === 'low', '助手配置独立保存并可读取');
  ok(fs.existsSync(path.join(CONFIG,'assistants.json')), '全局助手写入独立文件');
  let duplicate = false;
  try { await call('PUT','/api/assistants',[assistants[0],assistants[0]]); } catch { duplicate = true; }
  ok(duplicate && (await call('GET','/api/assistants')).length === 2, '重复助手编号拒绝且保留原配置');
  const full = await call('GET', `/api/projects/${blank.id}`);
  full.canvasNotes = [{id:'note-test',no:1,text:'修改标题',x:10,y:20,color:'#e5484d'}];
  full.assistantChats = {'test-red': {draft:'继续设计',msgs:[{role:'user',text:'修改红色标记'}]}};
  await call('PUT',`/api/projects/${blank.id}`,full);
  const saved = await call('GET',`/api/projects/${blank.id}`);
  ok(saved.canvasNotes[0].text === '修改标题' && saved.assistantChats['test-red'].draft === '继续设计', '项目保存画布便签和助手对话');
  ok(!(await call('GET',`/api/projects/${imp.id}`)).assistantChats, '对话不串到其它项目');
} catch (e) { fail++; console.log('  ✗', e.message); }
for (const id of made) { try { await call('DELETE', `/api/projects/${id}`); } catch { /* 忽略 */ } }
await new Promise((r) => { srv.once('exit', r); srv.kill(); });
if (path.resolve(CONFIG).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(CONFIG).startsWith('centdeck-api-test-')) fs.rmSync(CONFIG, {recursive:true,force:true});
console.log(`接口测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
