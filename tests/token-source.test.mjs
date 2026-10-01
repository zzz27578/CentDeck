/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import assert from 'node:assert/strict';
import { injectTokens } from '../app/js/panels/token-source.js';
import { parse } from '../app/js/vendor/parse5.js';

for (const source of [
  '<!DOCTYPE html><HTML><HEAD><STYLE id=\'cd-tokens\'>:root{--brand:red}</STYLE><style>body{color:black}</style></HEAD><BODY><p>Hello</p></BODY></HTML>',
  '<!doctype html><title>标题</title><p>hello',
  '<p>hello',
  '<head><style id="cd-tokens">old</style><style id="cd-tokens">duplicate</style></head><body><p>hello</p>',
]) {
  const css = ':root{--brand:#123456}', result = injectTokens(source, css);
  assert.equal((result.match(/id="cd-tokens"/g) || []).length, 1);
  assert.ok(result.includes(css));
  const tree = parse(result), tags = [];
  const walk = n => { if(n.tagName) tags.push(n.tagName); n.childNodes?.forEach(walk); }; walk(tree);
  assert.ok(tags.includes('p'));
  assert.equal((injectTokens(result, css).match(/id="cd-tokens"/g) || []).length, 1);
}
assert.ok(!injectTokens('<p>hello', '</style><script>bad()</script>').includes('</style><script>'));
console.log('设计规范源码测试：5 组通过');
