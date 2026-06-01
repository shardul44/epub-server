/**
 * Validate default/repair params for every curated H5P content type.
 * Usage: node scripts/validate-h5p-content-defaults.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const user = { id: 'bootstrap', name: 'Bootstrap', email: '', type: 'local' };

function listIssues(machineName, params, semantics, pathPrefix = '') {
  const issues = [];
  if (!Array.isArray(semantics)) return issues;

  for (const field of semantics) {
    if (!field?.name) continue;
    const p = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;

    if (field.type === 'group' && field.fields) {
      const child = params?.[field.name];
      issues.push(...listIssues(machineName, child ?? {}, field.fields, p));
      continue;
    }

    if (field.type === 'list' && field.field) {
      const min = Math.max(field.min ?? 0, field.defaultNum ?? 0);
      const arr = params?.[field.name];
      if (arr != null && !Array.isArray(arr)) {
        issues.push(`${machineName}: ${p} must be an array (got ${typeof arr})`);
      } else {
        const len = Array.isArray(arr) ? arr.length : 0;
        if (len < min) {
          issues.push(`${machineName}: ${p} has ${len} items (min ${min})`);
        }
        if (Array.isArray(arr) && field.field.type === 'group' && field.field.fields) {
          for (let i = 0; i < arr.length; i++) {
            issues.push(...listIssues(machineName, arr[i] ?? {}, field.field.fields, `${p}[${i}]`));
          }
        }
      }
    }
  }

  if (machineName === 'H5P.CoursePresentation' && !pathPrefix) {
    const slides = params?.presentation?.slides;
    if (!Array.isArray(slides) || slides.length === 0) {
      issues.push(`${machineName}: presentation.slides is empty`);
    }
  }

  return issues;
}

async function main() {
  const { CURATED_MACHINE_NAMES } = await import('../src/config/h5pContentTypes.js');
  const { buildInitialContentParams } = await import('../src/config/h5pContentTypeDefaults.js');
  const { getH5pEditor, ensureLibraryInstalled } = await import('../src/services/h5p/h5pService.js');
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const H5P = require('@lumieducation/h5p-server');

  const editor = await getH5pEditor();
  await editor.contentTypeCache.updateIfNecessary();

  let failed = 0;
  for (const machineName of CURATED_MACHINE_NAMES) {
    try {
      const uberName = await ensureLibraryInstalled(editor, machineName, user);
      const libraryName = H5P.LibraryName.fromUberName(uberName, { useWhitespace: true });
      const semantics = await editor.libraryManager.getSemantics(libraryName);
      const params = buildInitialContentParams(machineName, semantics);
      const issues = listIssues(machineName, params, semantics);
      if (issues.length) {
        failed += 1;
        console.log(`WARN ${machineName}`);
        for (const i of issues) console.log(`  - ${i}`);
      } else {
        console.log(`OK   ${machineName}`);
      }
    } catch (e) {
      failed += 1;
      console.log(`FAIL ${machineName}: ${e.message}`);
    }
  }

  console.log(failed ? `\n${failed} type(s) need attention.` : '\nAll curated types passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
