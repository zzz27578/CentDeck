/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
export const THINK = ["low", "medium", "high", "xhigh", "max", "ultra"].map(id => ({ id, label: id }));
export const normalizeThink = value => value === "mid" ? "medium" : value === "off" ? "low" : THINK.some(t => t.id === value) ? value : "medium";
