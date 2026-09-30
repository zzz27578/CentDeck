// Manual MCP acceptance client. Set CENTDECK_CONFIG_DIR and CENTDECK_URL for a QA fixture.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ext=require('../server/extensions');
const {CONFIG_DIR}=require('../server/store');
const endpoint=process.env.CENTDECK_URL||'http://127.0.0.1:8420';
const saved=path.join(CONFIG_DIR,'mcp-probe-session.json');
let session=fs.existsSync(saved)?JSON.parse(fs.readFileSync(saved)).session:'';
let sequence=0;
export async function rpc(method,params={}){
  const r=await fetch(endpoint+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+ext.mcpConfig().token,'Content-Type':'application/json',...(session?{'Mcp-Session-Id':session}:{})},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});
  if(r.headers.get('Mcp-Session-Id')){session=r.headers.get('Mcp-Session-Id');fs.writeFileSync(saved,JSON.stringify({session}));}
  const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;
}
export async function call(name,args={}){const r=await rpc('tools/call',{name,arguments:args});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);}
if(!session||process.argv[2]==='initialize')await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'Codex-CentDeck-Acceptance',version:'1.0.0'}});
if(process.argv[2]&&process.argv[2]!=='initialize'){
  const name=process.argv[2];const args=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):{};
  console.log(JSON.stringify(await call(name,args),null,2));
}
