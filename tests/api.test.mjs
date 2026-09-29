// 服务端接口回归：node tests/api.test.mjs（会临时启动一个服务，结束后清理测试项目）
import { spawn } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 测试会改模型设置，结束后原样放回，不影响真实使用
const SETTINGS = path.join(ROOT, 'config.local', 'settings.json');
const savedSettings = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
const restoreSettings = () => { if (savedSettings == null) fs.rmSync(SETTINGS, { force: true }); else fs.writeFileSync(SETTINGS, savedSettings); };
const PORT = 8490;
const srv = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), CENTDECK_NO_OPEN: '1' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const call = async (method, p, body) => {
  const res = await fetch(`http://localhost:${PORT}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json();
  if (!j.ok) throw new Error(`${method} ${p}: ${j.error}`);
  return j.data;
};
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('  ✗', n); } };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const made = [];
try {
  const blank = await call('POST', '/api/projects', { blank: true, name: 'api-test 空白' });
  made.push(blank.id);
  ok(blank.pages.length === 0 && blank.kind === 'blank', '空白项目没有页面');
  let proj = await call('POST', `/api/projects/${blank.id}/pages`, { title: 'Home' });
  ok(proj.pages.length === 1 && proj.pages[0].file === 'pages/home.html', '新建页面');
  proj = await call('POST', `/api/projects/${blank.id}/reset`, {});
  ok(proj.pages.length === 0, '空白项目一键还原后回到没有页面');

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
} catch (e) { fail++; console.log('  ✗', e.message); }
for (const id of made) { try { await call('DELETE', `/api/projects/${id}`); } catch { /* 忽略 */ } }
await new Promise((r) => { srv.once('exit', r); srv.kill(); });
restoreSettings();
console.log(`接口测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
