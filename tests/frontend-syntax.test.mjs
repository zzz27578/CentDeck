/* Copyright (c) 2026 zzz27578 and CentDeck contributors.
 * SPDX-License-Identifier: AGPL-3.0-only */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

if (!vm.SourceTextModule)
  throw Error(
    "Run: node --experimental-vm-modules tests/frontend-syntax.test.mjs",
  );
const root = path.resolve(import.meta.dirname, "../app/js");
let count = 0;
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (file.endsWith(".js")) {
      new vm.SourceTextModule(fs.readFileSync(file, "utf8"), {
        identifier: file,
      });
      count++;
    }
  }
}
scan(root);
console.log(`Frontend ESM syntax: ${count} modules passed`);
