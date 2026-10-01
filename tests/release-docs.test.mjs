/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createHash} from 'node:crypto';
const readmes=['README.md','README.zh-TW.md','README.en.md'];
for(const file of readmes){
  const source=fs.readFileSync(file,'utf8');
  for(const language of readmes)assert(source.includes(']('+language+')'),file+' missing language link');
  assert(!/验证状态|收尾验收|Scope and verification|401|阶段对话核查/.test(source),file+' contains internal audit copy');
  assert(source.includes('docs/assets/centdeck-light.svg')&&source.includes('docs/assets/centdeck-dark.svg'));
  const screenshots=[...source.matchAll(/!\[[^\]]*\]\((docs\/assets\/screenshots\/[^)]+)\)/g)].map(m=>m[1]);assert.equal(screenshots.length,4);
  for(const match of source.matchAll(/\]\(([^)]+)\)/g)){const target=match[1];if(!/^(https?:|#)/.test(target))assert(fs.existsSync(path.resolve(target)),file+' broken link '+target);}
}
assert(!fs.readFileSync('README.md','utf8').includes('## English'));
assert(fs.readFileSync('LICENSE','utf8').includes('No rebranded replicas'));
const topics=JSON.parse(fs.readFileSync('.github/topics.json','utf8'));assert(topics.length<=20&&new Set(topics).size===topics.length);assert(topics.every(t=>/^[a-z0-9-]+$/.test(t)));
assert(fs.readFileSync('.github/workflows/ci.yml','utf8').includes('tests/run-checks.mjs'));
const media=JSON.parse(fs.readFileSync('docs/assets/screenshots/sources.json','utf8'));
for(const image of media.screenshots){const data=fs.readFileSync('docs/assets/screenshots/'+image.file),parts=[];for(let i=8;i<data.length;){const length=data.readUInt32BE(i),kind=data.toString('ascii',i+4,i+8);if(kind==='IDAT')parts.push(data.subarray(i+8,i+8+length));i+=12+length;}assert.equal(createHash('sha256').update(Buffer.concat(parts)).digest('hex'),image.imageDataSha256,'provided screenshot pixels remain unchanged');}
console.log('Release docs: standalone language pages, current screenshots, local links, brand assets, license, topics and real CI badge passed');
