/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import {spawnSync} from 'node:child_process';
const browser=process.argv.includes('--browser');
const cases=browser?['reliability-browser','conversations-browser','i18n-browser','templates-release','capture-page','mcp-transport']:[
  'frontend-syntax','engine','reliability','api','agent-runtime','providers','provider-options','extensions','skills','external-agent','external-runtime','mcp-improvements','mcp-client','frame-scheduling','scan','token-source','workspace-state','note-numbers','composer','conversations','i18n','workbench-interactions','yubai','release-docs','repository-privacy'
];
for(const name of cases){
  console.log('\nChecking '+name);
  const result=spawnSync(process.execPath,['--experimental-vm-modules','tests/'+name+'.test.mjs'],{stdio:'inherit',windowsHide:true});
  if(result.status!==0)process.exit(result.status||1);
}
console.log('\nAll '+cases.length+' check suites passed.');
