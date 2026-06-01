/**
 * Install curated H5P content-type libraries from the H5P Hub.
 * Usage: node scripts/install-h5p-libraries.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const MACHINE_NAMES = [
  'H5P.MultiChoice',
  'H5P.TrueFalse',
  'H5P.Blanks',
  'H5P.DragText',
  'H5P.MarkTheWords',
  'H5P.Essay',
  'H5P.InteractiveVideo',
  'H5P.CoursePresentation',
  'H5P.ImageHotspots',
  'H5P.ImageSequencing',
  'H5P.MemoryGame',
  'H5P.Crossword',
  'H5P.ImageMultipleHotspotQuestion',
  'H5P.Flashcards',
  'H5P.Accordion',
  'H5P.Timeline',
  'H5P.BranchingScenario'
];

const user = { id: 'bootstrap', name: 'Bootstrap', email: '', type: 'local' };

async function main() {
  const { getH5pEditor, ensureLibraryInstalled } = await import('../src/services/h5p/h5pService.js');
  const editor = await getH5pEditor();
  await editor.contentTypeCache.updateIfNecessary();

  for (const name of MACHINE_NAMES) {
    try {
      const uber = await ensureLibraryInstalled(editor, name, user);
      console.log(`OK  ${name} -> ${uber}`);
    } catch (e) {
      console.error(`FAIL ${name}:`, e.message);
    }
  }
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
