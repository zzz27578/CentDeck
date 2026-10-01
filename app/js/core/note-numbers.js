/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
// Display numbers may be reused; identity and assistant references always use id.
export function nextColorNumber(list, color, except) {
  const used = new Set(list.filter(n => n !== except && n.color?.toLowerCase() === color?.toLowerCase()).map(n => n.no));
  let number = 1;
  while (used.has(number)) number++;
  return number;
}
export function migrateColorNumbers(project, key) {
  const version = key + 'NumberingVersion';
  if (project[version] === 2) return;
  const counts = new Map();
  for (const note of project[key] || []) {
    note.legacyNo ??= note.no;
    const color = String(note.color || '').toLowerCase();
    note.no = (counts.get(color) || 0) + 1;
    counts.set(color, note.no);
  }
  project[version] = 2;
  if(key==='marks')for(const chat of Object.values(project.assistantChats||{}))for(const ref of chat.refs||[]){
    if(ref.kind!=='mark'||ref.id)continue;
    const mark=project.marks.find(m=>m.legacyNo===ref.no&&(!ref.page||m.page===ref.page));
    if(mark)Object.assign(ref,{id:mark.id,color:mark.color,no:mark.no});
  }
}
