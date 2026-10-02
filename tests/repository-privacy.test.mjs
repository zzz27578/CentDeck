/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', windowsHide: true});
const files = git('ls-files', '-z').split('\0').filter(Boolean);
const privatePaths = [
  /(^|\/)(config\.local|\.centdeck|node_modules|\.ssh)\//i,
  /^projects\/(?!\.gitkeep$)/i,
  /^(artifacts|coverage|dist|报告|图片|视频|docs\/screenshots)\//i,
  /(^|\/)\.env(?:$|\.(?!example$|template$))/i,
  /\.(?:local|log|tmp|bak|zip|pem|key|p12|pfx|keystore|swp|swo)$/i,
  /(^|\/)(?:id_rsa|id_ed25519)$/i,
];
const unexpected = files.filter(file => privatePaths.some(rule => rule.test(file)));
assert.deepEqual(unexpected, [], 'Private or generated files must not be tracked');

// Check the portable ignore rules, without relying on this machine's excludes.
const ignoreFile = fs.readFileSync('.gitignore', 'utf8');
const expectedRules = [
  'config.local/', '/projects/*', '!/projects/.gitkeep', '.centdeck/',
  '.env', '.env.*', '*.pem', '*.key', '*.log', '*.zip',
  '/artifacts/', '/报告/', '/图片/', '/视频/', '/docs/screenshots/',
];
for (const rule of expectedRules) assert(ignoreFile.split(/\r?\n/).includes(rule), 'Missing privacy ignore rule: ' + rule);

const textFiles = files.filter(file => /\.(?:[cm]?js|json|html|css|md|ya?ml|toml|bat|sh)$/.test(file));
for (const file of textFiles) {
  const source = fs.readFileSync(file, 'utf8');
  // Report only filenames, never matching private content.
  assert(!/\b[A-Z]:[\\/]Users[\\/][^\s"'<>`\\/]+/i.test(source), 'Personal machine path in ' + file);
  assert(!/\bcodex:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(source), 'Private conversation reference in ' + file);
}
console.log('Repository privacy: tracked files and portable ignore rules passed');
