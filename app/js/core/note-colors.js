/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import { text as i18nText, template as i18nTpl } from './i18n.js';
export const COLORS=['#e5484d','#f5a524','#16a34a','#3b82f6','#8b5cf6','#1f2430'];
const NAMES=[i18nText('红色'),i18nText('黄色'),i18nText('绿色'),i18nText('蓝色'),i18nText('紫色'),i18nText('墨色')];
export const notePalette=color=>`<div class="note-palette">${COLORS.map((c,i)=>`<button type="button" data-c="${c}" aria-label="${NAMES[i]}" aria-pressed="${c===color}" style="--swatch:${c}" class="${c===color?'on':''}"></button>`).join('')}</div>`;
