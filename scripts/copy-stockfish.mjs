/**
 * copy-stockfish.mjs
 *
 * Copies Stockfish WASM files from node_modules into public/stockfish/
 * so they can be served as static assets and loaded as a Web Worker.
 *
 * Run automatically via the "postinstall" npm script.
 */

import { mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const src = join(root, 'node_modules', 'stockfish', 'src');
const dest = join(root, 'public', 'stockfish');

const files = [
  // Multi-threaded build (used when SharedArrayBuffer is available)
  'stockfish-nnue-16.js',
  'stockfish-nnue-16.wasm',
  // Single-threaded fallback
  'stockfish-nnue-16-single.js',
  'stockfish-nnue-16-single.wasm',
];

mkdirSync(dest, { recursive: true });

for (const file of files) {
  const from = join(src, file);
  const to = join(dest, file);
  if (!existsSync(from)) {
    console.warn(`[copy-stockfish] WARNING: ${from} not found — skipping`);
    continue;
  }
  copyFileSync(from, to);
  console.log(`[copy-stockfish] ${file} → public/stockfish/`);
}
