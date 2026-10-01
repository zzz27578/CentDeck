/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
// 总览扫描回归：node tests/scan.test.mjs —— 两个内置模板的链接、弹窗、跳转都要识别出来
import fs from 'fs';
import { scanPage } from '../app/js/overview/scan.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('  ✗', n); } };
const load = (t) => {
  const directory=t==='admin'?'tests/fixtures/legacy-admin':`templates/${t}`;
  const meta = JSON.parse(fs.readFileSync(`${directory}/project.json`, 'utf8'));
  const set = new Set(meta.pages.map((p) => p.file));
  const out = {};
  meta.pages.forEach((p) => { out[p.file.replace('pages/', '')] = scanPage(p.file, fs.readFileSync(`${directory}/${p.file}`, 'utf8'), set); });
  return out;
};
const site = load('site');
const to = (s) => new Set(s.links.filter((l) => !l.self).map((l) => l.to.replace('pages/', '')));
ok(to(site['index.html']).has('pricing.html') && to(site['index.html']).has('contact.html'), '官网首页 → 价格 / 联系');
ok(site['index.html'].popups.length === 1 && site['index.html'].popups[0].triggers.length === 2, '首页弹窗：两个按钮打开');
ok(site['index.html'].anchors.length >= 2, '首页页内锚点');
ok(site['pricing.html'].popups.length === 1, '价格页弹窗');
ok(site['contact.html'].redirects.some((r) => r.kind === 'submit' && r.to === 'pages/thanks.html'), '联系页提交后跳转');
ok(site['thanks.html'].redirects.some((r) => r.kind === 'timer' && r.delay === 5000), '感谢页 5 秒自动返回');
const admin = load('admin');
ok(admin['index.html'].popups.some((p) => p.title === '新建订单'), '后台 dialog 弹窗');
ok(admin['orders.html'].popups.length === 1, '订单详情弹窗');
ok(to(admin['orders.html']).has('index.html'), '订单页 → 概览');
console.log(`扫描测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
