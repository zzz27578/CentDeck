export const COLORS=['#e5484d','#f5a524','#16a34a','#3b82f6','#8b5cf6','#1f2430'];
const NAMES=['红色','黄色','绿色','蓝色','紫色','墨色'];
export const notePalette=color=>`<div class="note-palette">${COLORS.map((c,i)=>`<button type="button" data-c="${c}" aria-label="${NAMES[i]}" aria-pressed="${c===color}" style="--swatch:${c}" class="${c===color?'on':''}"></button>`).join('')}</div>`;
