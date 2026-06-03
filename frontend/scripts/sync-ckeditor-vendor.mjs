/**
 * Copies the H5P CKEditor 5 bundle (includes FontFamily/FontSize) into frontend vendor.
 * Run after updating backend/h5p/editor/ckeditor/ckeditor.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.resolve(root, '../backend/h5p/editor/ckeditor/ckeditor.js');
const dest = path.resolve(root, 'src/vendor/ckeditor-text-block.js');

if (!fs.existsSync(src)) {
  console.warn('[sync-ckeditor-vendor] Source not found:', src);
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('[sync-ckeditor-vendor] Copied to', dest);
