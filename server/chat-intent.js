/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
// Deliberately narrow: ambiguous requests keep the normal project tools.
function directReply(text, refs=[]) {
  if(refs.length)return false;
  const s=text.trim().replace(/[。！!？?]+$/u,'');
  return /^(你好|您好|嗨|hello|hi|谢谢|感谢)$/iu.test(s)
    || /^(?:(?:你好|您好)[，,、\s]*)?(?:收到(?:后)?[，,、\s]*)?(?:请)?(?:只(?:需|要)?|仅)?(?:回复|回答)\s*[：:]?\s*(?:[A-Za-z0-9_.-]{1,40}|[“"'][^“”"'\n]{1,60}[”"'])$/u.test(s);
}
module.exports={directReply};
