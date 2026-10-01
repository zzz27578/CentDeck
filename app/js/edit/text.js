/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
// 就地改字：点哪里光标就在哪里（像 Word）；回车确认、Esc 取消、点别处自动确认。
// 提交时逐个元素对比"文字段"，只把变了的字符写回源码；如果删掉了里面的换行、加粗等结构，整次取消。
import { toast } from '../core/ui.js';

function capture(e) {
  const anchors = [], gaps = [''];
  e.childNodes.forEach((n) => {
    if (n.nodeType === 3) gaps[gaps.length - 1] += n.data;
    else if (n.nodeType === 1 || n.nodeType === 8) { anchors.push(n); gaps.push(''); }
  });
  return { el: e, loc: +e.getAttribute('data-cd-loc'), anchors, gaps };
}
function snapshot(root) {
  const items = [];
  const walk = (e) => { if (e.hasAttribute('data-cd-loc')) items.push(capture(e)); [...e.children].forEach(walk); };
  walk(root);
  return items;
}

export function diffText(before) {
  const changes = [];
  for (const it of before) {
    if (!it.el.isConnected) return { structural: true };
    const now = capture(it.el);
    if (now.anchors.length !== it.anchors.length || now.anchors.some((n, i) => n !== it.anchors[i])) return { structural: true };
    let seg = 0;
    for (let j = 0; j < it.gaps.length; j++) {
      const o = it.gaps[j], n = now.gaps[j];
      if (o === '') { if (n !== '') return { unsupported: true }; continue; }
      if (o !== n) changes.push({ loc: it.loc, index: seg, oldText: o, newText: n });
      seg++;
    }
  }
  return { changes };
}

// ed: 编辑器内部接口；target: 带门牌号的元素；pt: 设备坐标（放光标用），为空则全选
export function startTextEdit(ed, target, pt) {
  const doc = ed.frame.doc, win = ed.frame.win;
  if (!target || !doc) return;
  const before = snapshot(target);
  const prevCE = target.getAttribute('contenteditable');
  const prevSpell = target.getAttribute('spellcheck');
  try { target.contentEditable = 'plaintext-only'; } catch { target.contentEditable = 'true'; }
  if (target.contentEditable !== 'plaintext-only') target.contentEditable = 'true';
  target.setAttribute('spellcheck', 'false');
  target.style.outline = 'none';
  target.style.cursor = 'text';
  ed.ov.root.classList.add('editing');
  ed.ov.sel.classList.add('editing');
  ed.textEditing = true;
  target.focus({ preventScroll: true });
  const sel = win.getSelection();
  let range = null;
  if (pt && doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(pt.x, pt.y);
  if (!range || !target.contains(range.startContainer)) { range = doc.createRange(); range.selectNodeContents(target); }
  sel.removeAllRanges();
  sel.addRange(range);
  ed.setHint(i18nText('改字中 · <b>回车</b> 确认 · <b>Esc</b> 取消 · 点页面别处也会确认'));

  let done = false;
  const finish = (cancel) => {
    if (done) return;
    done = true;
    target.removeEventListener('keydown', onKey, true);
    target.removeEventListener('blur', onBlur);
    win.removeEventListener('blur', onBlur);
    if (prevCE == null) target.removeAttribute('contenteditable'); else target.setAttribute('contenteditable', prevCE);
    if (prevSpell == null) target.removeAttribute('spellcheck'); else target.setAttribute('spellcheck', prevSpell);
    target.style.outline = '';
    target.style.cursor = '';
    if (!target.getAttribute('style')) target.removeAttribute('style');
    try { win.getSelection().removeAllRanges(); } catch { /* 忽略 */ }
    target.blur();
    if (document.activeElement && document.activeElement.tagName === 'IFRAME') document.activeElement.blur();
    ed.ov.root.classList.remove('editing');
    ed.ov.sel.classList.remove('editing');
    ed.textEditing = false;
    ed.setHint('');
    const res = diffText(before);
    if (cancel) { if (res.changes && res.changes.length) ed.rerender(); return; }
    if (res.structural) {
      ed.rerender();
      ed.showVerdict({ light: 'red', reason: i18nText('改字时把里面的换行、加粗或图标之类的结构删掉或挪动了。这属于改结构，已恢复原样；只改文字就能直接写回。') }, { label: i18nText('改字') });
      return;
    }
    if (res.unsupported) {
      ed.rerender();
      ed.showVerdict({ light: 'red', reason: i18nText('在原来没有文字的位置新增了文字，代码里找不到可以对应的一段，已恢复原样。可以把这句话写进草图标记交给 AI。') }, { label: i18nText('改字') });
      return;
    }
    if (!res.changes.length) return;
    ed.commitText(res.changes);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (!e.shiftKey) finish(false); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); return; }
    if (e.key === 'Tab') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => setTimeout(() => finish(false), 0);
  target.addEventListener('keydown', onKey, true);
  target.addEventListener('blur', onBlur);
  win.addEventListener('blur', onBlur);
  ed.cancelText = () => finish(true);
  ed.commitTextEdit = () => finish(false);
  if (ed.isLocked({ generated: false, selector: ed.selectorOf(target) })) { finish(true); toast(i18nText('这个元素已锁定'), 'err'); }
}
