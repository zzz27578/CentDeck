// 空白项目的起始画面（参考 Google Stitch）：一句话描述 → 助手在画布上铺出几版方案 → 挑一版再细调
import { el, esc, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getDevice } from '../core/viewport.js';

const EXAMPLES = [
  '一家精品咖啡店的官网：温暖的奶咖色调，首页、菜单、门店和线上预约四页',
  '个人作品集：极简黑白，大图瀑布流，点开看项目详情',
  '一款记账 App 的落地页：清新的薄荷绿，突出三个核心功能和下载按钮',
  'SaaS 后台：左侧导航、数据看板、订单列表，专业克制的深蓝色',
];

export function renderEmpty(app, host, { addPage }) {
  let count = 3;
  const box = el(`<div class="ov-empty"><div class="ove-card">
    <span class="ove-badge">${icon('sparkle', 13)}空白项目</span>
    <h2>从一句话开始</h2>
    <p>描述你想做的网站，助手会在这块画布上铺出几版方案；挑一版喜欢的，再进编辑细调。</p>
    <div class="ove-prompt"><textarea rows="3" placeholder="想做一个什么样的网站？说说用途、风格、要哪几页…"></textarea></div>
    <div class="ove-opts">
      <span class="chip">${icon(getDevice() === 'mobile' ? 'phone' : 'monitor', 12)}按${getDevice() === 'mobile' ? '手机' : '电脑'}设计</span>
      <div class="seg" data-count><button data-v="2">2 版</button><button data-v="3" class="on">3 版</button><button data-v="4">4 版</button></div>
      <span class="grow"></span>
      <button class="btn" data-a="blank">${icon('plus', 15)}先建一张空白页</button>
      <button class="btn primary" data-a="go">${icon('sparkle', 15)}生成方案</button>
    </div>
    <div class="ove-examples"></div>
    <p class="hint">第二步接入模型后，点"生成方案"就会直接画出来；现在会先把要求整理好放进助手输入框。</p>
  </div></div>`);
  const ta = box.querySelector('textarea');
  EXAMPLES.forEach((t) => {
    const b = el(`<button>${esc(t)}</button>`);
    b.onclick = () => { ta.value = t; ta.focus(); };
    box.querySelector('.ove-examples').appendChild(b);
  });
  box.querySelectorAll('[data-count] button').forEach((b) => {
    b.onclick = () => { count = +b.dataset.v; box.querySelectorAll('[data-count] button').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const go = () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    app.agent.prefill(`${text}\n\n请出 ${count} 版风格不同的方案，每版都按${getDevice() === 'mobile' ? '手机' : '电脑'}屏幕设计，画在总览画布上。`, { skill: 'design-variants' });
    toast('要求已经放进助手输入框，检查一下再发送', 'ok', 3600);
  };
  box.querySelector('[data-a=go]').onclick = go;
  box.querySelector('[data-a=blank]').onclick = addPage;
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
  host.appendChild(box);
  setTimeout(() => ta.focus(), 80);
}
