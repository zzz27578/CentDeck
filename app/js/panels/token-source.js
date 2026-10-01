/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import { parse } from '../vendor/parse5.js';

// 按源码位置修改，覆盖单引号、大写标签、无 head 和省略闭合标签。
export function injectTokens(source, css) {
  const tree = parse(source, { sourceCodeLocationInfo: true });
  const old = []; let head = null;
  const walk = n => {
    if (n.tagName === 'head') head = n;
    if (n.tagName === 'style' && n.attrs?.some(a => a.name === 'id' && a.value === 'cd-tokens') && n.sourceCodeLocation) old.push(n.sourceCodeLocation);
    n.childNodes?.forEach(walk);
  };
  walk(tree);
  const block = `<style id="cd-tokens">\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  if (old.length) {
    // 移到 head 末尾，避免后面的旧样式覆盖更新。
    for (const loc of old.reverse()) source = source.slice(0, loc.startOffset) + source.slice(loc.endOffset);
    return injectTokens(source, css);
  }
  const at = head?.sourceCodeLocation?.endTag?.startOffset ?? head?.sourceCodeLocation?.endOffset;
  if (at != null) return source.slice(0, at) + '\n' + block + '\n' + source.slice(at);
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(source);
  const pos = doctype ? doctype[0].length : 0;
  return source.slice(0, pos) + '\n' + block + '\n' + source.slice(pos);
}
