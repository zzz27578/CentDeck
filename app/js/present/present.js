/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from '../core/i18n.js';
import { toast } from '../core/ui.js';
import { getDevice } from '../core/viewport.js';
export function createPresent(app) {
  let back='overview';
  app.bus.on('view',v=>{if(v!=='present')back=v;});
  return {
    async enter(){
      const p=app.project();
      if(!p.pages.length){toast(i18nText('还没有页面可以放映'));queueMicrotask(()=>app.setView(back));return;}
      if(await app.bus.flushMeta()===false){app.setView(back);return;}
      const candidate=app.state.presentFrom||app.state.page;
      const file=p.pages.some(pg=>pg.file===candidate)?candidate:p.pages[0].file;
      const url='/show/'+encodeURIComponent(p.id)+'/'+file.split('/').map(encodeURIComponent).join('/')+'?from='+back+(getDevice()==='mobile'?'&mobile=1':'');
      location.assign(url);
    },
    leave(){}
  };
}
