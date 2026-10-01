/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
// Older running servers omit internal/official. Recognize the built-in identity
// as well, so a backend restart is never required merely to hide base skills.
const BUILTIN_IDS = new Set([
  'platform-guide', 'design-variants', 'design-system', 'tidy-import',
  'apply-marks', 'page-edit', 'centdeck-orchestrate',
]);
export function isPlatformSkill(skill) {
  return !!skill && (skill.internal === true || skill.official === true ||
    skill.source === 'builtin' || BUILTIN_IDS.has(skill.id) ||
    skill.id?.startsWith('official-inspector--'));
}
export const userSkills = (catalog, enabledOnly = false) =>
  (Array.isArray(catalog) ? catalog : []).filter(s => !isPlatformSkill(s) && (!enabledOnly || s.enabled !== false));
export const selectedUserSkill = (catalog, id) => userSkills(catalog, true).find(s => s.id === id) || null;
