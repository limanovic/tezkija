#!/usr/bin/env node
/*
 * Before a web export: put the files the web build fetches at runtime into
 * public/, which Expo copies to the site root as-is. Both are gitignored —
 * the database already lives in assets/, the wasm in node_modules.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const copies = [
  ['assets/quran.db', 'public/quran.db'],
    // Metro resolves sql.js to its browser build, which asks for this file by name.
  ['node_modules/sql.js/dist/sql-wasm-browser.wasm', 'public/sql-wasm-browser.wasm'],
];

for (const [from, to] of copies) {
  fs.copyFileSync(path.join(root, from), path.join(root, to));
  console.log(`${from} -> ${to}`);
}
