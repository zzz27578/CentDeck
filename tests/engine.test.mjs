/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
// 引擎回归测试：node tests/engine.test.mjs
// 覆盖各种"非规定"写法：缩进、压成一行、CRLF、<div />、省略结束标签、表格没写 tbody、实体、SVG 自闭合
import { parse, instrument } from '../app/js/engine/parse.js';
import { applyEdit } from '../app/js/engine/writeback.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('  ✗', name); } };
const find = (p, tag, i = 0) => p.elements.filter((e) => e.tag === tag)[i];
const txt = (src, e, k) => { const [a, b] = e.textNodes[k]; return src.slice(a, b); };

// 1. 主流缩进 + 行内元素贴着文字
{
  const src = `<!DOCTYPE html>\n<html lang="zh">\n  <head><title>t</title></head>\n  <body>\n    <main>\n      <h1>让团队的数据<br>像河流一样 <em>自由流动</em></h1>\n      <p>A &amp; B&nbsp;C <a href="x.html">链接</a> 结尾</p>\n    </main>\n  </body>\n</html>\n`;
  const p = parse(src), h1 = find(p, 'h1'), pp = find(p, 'p');
  ok(h1 && h1.textNodes.length === 2, '缩进：h1 有 2 个文本节点');
  ok(txt(src, h1, 1) === '像河流一样 ', '缩进：第二段文字位置');
  let r = applyEdit(src, { kind: 'textNode', target: h1.loc, index: 1, oldText: '像河流一样 ', newText: '像江河一样 ' });
  ok(r.light === 'green' && r.newSource.includes('<br>像江河一样 <em>'), '缩进：混排里改一段字');
  r = applyEdit(src, { kind: 'textNode', target: pp.loc, index: 0, oldText: 'A & B C ', newText: 'A & D C ' });
  ok(r.light === 'green' && r.newSource.includes('A &amp; D&nbsp;C'), '缩进：实体原样保留');
  ok(instrument(src).includes('<h1 data-cd-loc="'), '缩进：门牌号注入');
  r = applyEdit(src, { kind: 'style', target: find(p, 'a').loc, props: { 'font-family': '"PingFang SC", sans-serif' } });
  ok(parse(r.newSource).elements.find(e=>e.tag==='a').style === 'font-family: "PingFang SC", sans-serif;', '样式：字体名双引号不截断属性');
}
// 2. 压成一行
{
  const src = '<!doctype html><html><head><style>.a{color:red}</style></head><body><div class="a"><span>一</span><b>二</b>三</div></body></html>';
  const p = parse(src), div = find(p, 'div');
  ok(div.textNodes.length === 1 && txt(src, div, 0) === '三', '一行：文本节点');
  const r = applyEdit(src, { kind: 'move', target: div.loc, dx: 10, dy: 5 });
  ok(r.light === 'green' && r.newSource.includes('<div class="a" style="translate: 10px 5px;">'), '一行：挪位写回');
}
// 3. CRLF
{
  const src = '<body>\r\n<p>第一行\r\n第二行</p>\r\n</body>';
  const p = parse(src), pp = find(p, 'p');
  const r = applyEdit(src, { kind: 'textNode', target: pp.loc, index: 0, oldText: '第一行\n第二行', newText: '第一行\n第三行' });
  ok(r.light === 'green' && r.newSource.includes('第一行\r\n第三行'), 'CRLF：换行不被破坏');
}
// 4. <div /> 不是自闭合（和浏览器一致）
{
  const src = '<body><div class="x" /><p>里面</p></body>';
  const p = parse(src), pp = find(p, 'p');
  ok(pp.parent === find(p, 'div').loc, '<div />：p 属于 div（浏览器同款）');
}
// 5. 省略结束标签 + 表格没写 tbody
{
  const src = '<body><ul><li>一<li>二</ul><table><tr><td>格子</td></tr></table></body>';
  const p = parse(src);
  ok(p.elements.filter((e) => e.tag === 'li').length === 2 && find(p, 'li', 1).parent === find(p, 'ul').loc, '省略 </li>');
  const td = find(p, 'td');
  ok(td && /tbody/.test(td.selector), '表格：自动补 tbody 与浏览器一致');
  const r = applyEdit(src, { kind: 'textNode', target: find(p, 'li', 1).loc, index: 0, oldText: '二', newText: '贰' });
  ok(r.light === 'green' && r.newSource.includes('<li>贰</ul>'), '省略结束标签也能改字');
}
// 6. SVG 自闭合：门牌号插在 "/" 前，不破坏结构
{
  const src = '<body><svg viewBox="0 0 10 10"><path d="M0 0"/><circle r="1"/></svg><a href=foo/>x</a></body>';
  const out = instrument(src);
  ok(/<path d="M0 0" data-cd-loc="\d+"\/>/.test(out), 'SVG：自闭合保留');
  ok(/<a href=foo\/ data-cd-loc="\d+">/.test(out), '未加引号的属性值里的 "/" 不被当成自闭合');
}
// 7. 模板内容 / 脚本里的标签不进清单
{
  const src = '<body><template><p>模板</p></template><script>var s="<div>x</div>"</script><p>真</p></body>';
  const p = parse(src);
  ok(p.elements.filter((e) => e.tag === 'p').length === 1, 'template / script 内容不算元素');
}
// 8. 删空纯文字 → 红灯；原文对不上 → 红灯
{
  const src = '<body><h2>标题</h2></body>';
  const p = parse(src), h2 = find(p, 'h2');
  ok(applyEdit(src, { kind: 'textNode', target: h2.loc, index: 0, oldText: '标题', newText: '' }).light === 'red', '删空 → 红灯');
  ok(applyEdit(src, { kind: 'textNode', target: h2.loc, index: 0, oldText: '别的', newText: 'x' }).light === 'red', '原文不一致 → 红灯');
}

// 9. 只对手机生效：写进 @media，元素加 data-cd 标记（有唯一 id 就用 id），再次修改会更新同一条规则
{
  const src = '<!doctype html><html><head><title>t</title></head><body><h1 id="hero-title">标题</h1><p>段落</p></body></html>';
  let p = parse(src);
  let r = applyEdit(src, { kind: 'style', target: find(p, 'h1').loc, props: { 'font-size': '28px' }, media: 767 });
  ok(r.light === 'green' && r.newSource.includes('@media (max-width: 767px)') && r.newSource.includes('#hero-title { font-size: 28px !important; }'), '手机样式：有 id 用 #id');
  p = parse(r.newSource);
  r = applyEdit(r.newSource, { kind: 'move', target: find(p, 'p').loc, dx: 0, dy: 12, media: 767 });
  const v = /data-cd="(e[0-9a-z]+)"/.exec(r.newSource);
  ok(v && r.newSource.includes(`[data-cd="${v[1]}"] { translate: 0px 12px !important; }`), '手机样式：没 id 加 data-cd 标记');
  p = parse(r.newSource);
  r = applyEdit(r.newSource, { kind: 'move', target: find(p, 'p').loc, dx: 0, dy: 8, media: 767 });
  ok(r.newSource.includes('translate: 0px 20px !important;') && (r.newSource.match(/ data-cd="/g) || []).length === 1, '手机样式：再次挪动在原规则上累加');
  ok(!/<h1[^>]*style=/.test(r.newSource), '手机样式：不碰电脑版的行内样式');
}

console.log(`引擎测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
