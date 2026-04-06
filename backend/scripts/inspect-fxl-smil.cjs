/**
 * Inspect SMIL par order in a generated FXL EPUB.
 * Usage: node scripts/inspect-fxl-smil.cjs <path-to.epub> [pageNumber]
 * Example: node scripts/inspect-fxl-smil.cjs ../epub_output/fxl_1770014946732/kitaboo_fxl_1770014946732.epub 11
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const epubPath = process.argv[2];
const pageNum = process.argv[3] || '11';

if (!epubPath || !fs.existsSync(epubPath)) {
  console.error('Usage: node scripts/inspect-fxl-smil.cjs <path-to.epub> [pageNumber]');
  console.error('Example: node scripts/inspect-fxl-smil.cjs ../epub_output/fxl_1770014946732/kitaboo_fxl_1770014946732.epub 11');
  process.exit(1);
}

const smilEntry = `EPUB/page${pageNum}.smil`;
const tempDir = path.join(__dirname, '..', 'temp_smil_inspect');
fs.mkdirSync(tempDir, { recursive: true });

try {
  const isWin = process.platform === 'win32';
  const absEpub = path.resolve(epubPath);
  if (isWin) {
    execSync(
      `powershell -Command "Expand-Archive -Path '${absEpub.replace(/'/g, "''")}' -DestinationPath '${tempDir.replace(/'/g, "''")}' -Force"`,
      { stdio: 'pipe' }
    );
  } else {
    execSync(`unzip -o -j "${absEpub}" "${smilEntry}" -d "${tempDir}"`, { stdio: 'pipe' });
  }

  // EPUB zip has EPUB/page11.smil; PowerShell extracts to tempDir/EPUB/, unzip -j to tempDir/
  let smilPath = path.join(tempDir, 'EPUB', `page${pageNum}.smil`);
  if (!fs.existsSync(smilPath)) smilPath = path.join(tempDir, `page${pageNum}.smil`);
  if (!fs.existsSync(smilPath)) {
    console.error(`Not found: EPUB/page${pageNum}.smil or page${pageNum}.smil in ${epubPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(smilPath, 'utf8');
  const parMatches = content.matchAll(/<par\s+id="(par_[^"]+)"[^>]*>[\s\S]*?<audio[^>]*clipBegin="([^"]+)"[^>]*clipEnd="([^"]+)"/g);
  const pars = [...parMatches].map((m) => ({ id: m[1], clipBegin: m[2], clipEnd: m[3] }));

  console.log(`\npage${pageNum}.smil par order (as in file):`);
  if (pars.length === 0) {
    console.log('  (no <par> with clipBegin/clipEnd found)');
  } else {
    pars.forEach((p, i) => console.log(`  ${i + 1}. ${p.id}  ${p.clipBegin} – ${p.clipEnd}`));
    const order = pars.map((p) => p.id.replace('par_', '')).join(' → ');
    console.log(`\nOrder: ${order}`);
    const starts = pars.map((p) => parseFloat(p.clipBegin.replace('s', '')));
    const isChronological = starts.every((s, i) => i === 0 || s >= starts[i - 1]);
    console.log(isChronological ? '\nChronological: YES (reader should not stop)' : '\nChronological: NO (reader may stop after first out-of-order par)');
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}
}
