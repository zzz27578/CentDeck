/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../app/js/core/note-numbers.js',import.meta.url),'utf8');
const {nextColorNumber,migrateColorNumbers}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const p={marks:[{id:'a',no:1,color:'red'},{id:'b',no:2,color:'blue'},{id:'c',no:3,color:'red'}]};
p.assistantChats={demo:{refs:[{kind:'mark',no:2}]}};
migrateColorNumbers(p,'marks');assert.equal(p.assistantChats.demo.refs[0].id,'b');assert.equal(p.assistantChats.demo.refs[0].no,1);assert.deepEqual(p.marks.map(n=>[n.id,n.no]),[['a',1],['b',1],['c',2]]);
assert.equal(nextColorNumber(p.marks,'blue'),2);
assert.equal(nextColorNumber(p.marks,'red'),3);
const removed=p.marks.splice(0,1)[0];assert.equal(nextColorNumber(p.marks,'red'),1);
const replacement={id:'d',color:'red',no:nextColorNumber(p.marks,'red')};p.marks.push(replacement);
assert.equal(p.marks.find(n=>n.id==='c').no,2,'deletion must not renumber existing references');
p.marks.pop();p.marks.unshift(removed);assert.equal(nextColorNumber(p.marks,'red'),3,'undo restores the occupied number');
const changing=p.marks.find(n=>n.id==='b');changing.no=nextColorNumber(p.marks,'red',changing);changing.color='red';
assert.equal(changing.no,3);assert.equal(nextColorNumber(p.marks,'blue'),1);
migrateColorNumbers(p,'marks');assert.equal(changing.no,3,'migration is idempotent');
console.log('Notes: color counters, gap reuse, stable ids, recoloring, undo and one-time migration passed');
