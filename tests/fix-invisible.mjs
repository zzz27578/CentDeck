/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
// 把源码里看不见的 BOM 字符（U+FEFF）换成显式的 ﻿ 写法：node tests/fix-invisible.mjs
import fs from 'fs';
import path from 'path';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
let changed = 0;
for (const f of walk('app/js').filter((x) => x.endsWith('.js'))) {
  const s = fs.readFileSync(f, 'utf8');
  const body = s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  if (!body.includes('﻿') && body === s) continue;
  fs.writeFileSync(f, body.replace(/﻿/g, '\\uFEFF'));
  changed++;
  console.log('fixed', f);
}
console.log(changed ? `${changed} 个文件已处理` : '没有发现不可见字符');
