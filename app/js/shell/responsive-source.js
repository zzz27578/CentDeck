/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: LicenseRef-CentDeck-Source-1.0 */
export function inspectResponsiveSource(html, css = '') {
  const styles = html + '\n' + css;
  return {
    viewport: /<meta\b[^>]*name\s*=\s*["']?viewport\b/i.test(html),
    responsive: /@(?:media|container)[^{]*(?:width|orientation)|\b(?:sm|md|lg|xl|2xl|max-sm|max-md):/.test(styles),
    fluid: /\b(?:clamp|minmax)\s*\(|auto-fit|auto-fill/.test(styles),
  };
}
