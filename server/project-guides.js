'use strict';
const fs=require('node:fs'),path=require('node:path');
function ensure(dir){
  const files={
    'AGENTS.md':'# CentDeck project\n\nThis folder contains a real frontend project. Read project.json for pages, marks, notes and locks; read DESIGN.md and design/tokens.json if present. Prefer the CentDeck MCP tools for changes: read_page before write_files, preserve baseHash, respect locks and plan/create mode. UI changes use ui_state/ui_action. Do not claim browser validation without inspecting the browser. Never read config.local from the parent application. Filesystem access outside MCP is not constrained by CentDeck permissions.\n',
    'DESIGN.md':'# Design / 设计规范\n\nDesign tokens, when configured, are stored in design/tokens.json. Read the actual page CSS before changes; imported hard-coded styles may not use the tokens. Keep navigation, typography, colors and responsive behavior consistent. Preserve explicit user exceptions.\n\n设计规范以 design/tokens.json（如果存在）和真实页面源码为准；导入页面的固定样式不一定使用令牌。保持导航、字体、配色与响应式一致，尊重用户明确的局部例外。\n'
  };
  for(const [name,content]of Object.entries(files))if(!fs.existsSync(path.join(dir,name)))fs.writeFileSync(path.join(dir,name),content);
}
module.exports={ensure};
