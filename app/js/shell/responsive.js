/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
import { attr } from '../engine/parse.js';
import { openModal, esc } from '../core/ui.js';
import { getDevice } from '../core/viewport.js';

import { inspectResponsiveSource } from './responsive-source.js';

const checked = new Map();
export async function checkMobileProject(app) {
  const proj = app.project(); if (!proj || getDevice() !== 'mobile' || !proj.pages.length) return;
  const files = app.view() === 'edit' ? proj.pages.filter(p => p.file === app.state.page) : proj.pages;
  const reports = [];
  for (const page of files) {
    let html; try { html = await app.api.readFile(proj.id, page.file, {toast:false}); } catch { continue; }
    const key = `${proj.id}/${page.file}`;
    let css = '', unknown = false;
    for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
      if (!/stylesheet/i.test(attr(tag, 'rel') || '')) continue;
      const href = attr(tag, 'href'); if (!href) continue;
      try {
        const url = new URL(href, 'http://centdeck.local/' + page.file);
        if (url.origin !== 'http://centdeck.local') { unknown = true; continue; }
        css += await app.api.readFile(proj.id, decodeURIComponent(url.pathname.slice(1)), {toast:false});
      } catch { unknown = true; }
    }
    const fingerprint = html + css; if (checked.get(key) === fingerprint) continue;
    checked.set(key, fingerprint);
    const result = inspectResponsiveSource(html, css);
    if (!result.responsive || !result.viewport) reports.push({page,...result,unknown});
  }
  if (!reports.length || app.project()?.id !== proj.id || getDevice() !== 'mobile') return;
  openModal({ title: i18nText('手机版体检'), width: 540,
    body: i18nTpl`<p>手机视口会触发页面已有的响应式规则。以下页面需要留意：</p><ul class="mobile-report">${reports.map(r => `<li><b>${esc(r.page.title)}</b><br>${!r.viewport ? i18nText('缺少手机视口声明。') : ''}${!r.responsive ? (r.unknown ? i18nText('部分外部样式未能检查，无法确认是否有手机版样式。') : i18nText('未检测到手机断点样式，窄屏布局可能需要调整。')) : ''}${r.fluid ? i18nText('检测到自适应布局。') : ''}</li>`).join('')}</ul><p class="hint">没有断点也可能通过弹性布局适配；请结合实际页面检查。这里只检测样式，不会自动修改页面。</p>`,
    actions: [{label:i18nText('继续查看')}, {label:i18nText('交给助手补手机版'),kind:'primary',onClick: close => {
      close(); app.agent.prefill(i18nTpl`请检查项目「${proj.name}」的手机版布局：\n${reports.map(r => `- ${r.page.title}（${r.page.file}）`).join('\n')}\n保留电脑版设计和交互，补齐手机视口与响应式样式，避免横向溢出，适配 360–430px 宽屏幕。`, {skill:'page-edit'});
    }}],
  });
}
