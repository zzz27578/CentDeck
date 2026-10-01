/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
'use strict';
// ZIP (stored entries, UTF-8) without a build step or third-party runtime.
const fs=require('node:fs'),path=require('node:path'),store=require('./store');
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(data){let n=0xffffffff;for(const x of data)n=table[(n^x)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function exportProject(id){
  const root=store.projectDir(id),entries=[];let total=0;
  function walk(dir,prefix=''){
    for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
      if(ent.name.startsWith('.')||['node_modules','config.local'].includes(ent.name))continue;
      const rel=prefix+ent.name,full=path.join(dir,ent.name);
      if(ent.isSymbolicLink())continue;
      if(ent.isDirectory()){walk(full,rel+'/');continue;}
      if(!ent.isFile())continue;
      const stat=fs.statSync(full);total+=stat.size;
      if(total>100*1024*1024||entries.length>=10000)throw new store.ApiError(413,'导出超过 100 MB 或 10000 个文件，请直接复制项目文件夹');
      entries.push({name:Buffer.from(rel),data:fs.readFileSync(full)});
    }
  }walk(root);
  let offset=0;const parts=[],central=[];
  for(const {name,data}of entries){
    const local=Buffer.alloc(30),head=Buffer.alloc(46),sum=crc(data);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(sum,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    head.writeUInt32LE(0x02014b50);head.writeUInt16LE(20,4);head.writeUInt16LE(20,6);head.writeUInt16LE(0x800,8);head.writeUInt16LE(33,14);head.writeUInt32LE(sum,16);head.writeUInt32LE(data.length,20);head.writeUInt32LE(data.length,24);head.writeUInt16LE(name.length,28);head.writeUInt32LE(offset,42);
    parts.push(local,name,data);central.push(head,name);offset+=local.length+name.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,directory,end]);
}
module.exports={exportProject};
