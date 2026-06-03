import { releaseH5pEditorViewportLock } from './h5pEditorViewportLock';
import { ensureH5pHostShellWidthFix } from './h5pEditorStyles';

/**
 * H5P editor appends overlays/dialogs to document.body. When the host MUI Dialog
 * closes or the user navigates away, these nodes and global flags can linger
 * and break the editor on the next visit.
 */
export function cleanupH5pEditorDomArtifacts() {
  if (typeof document === 'undefined') return;

  const selectors = [
    '.h5p-metadata-popup-overlay',
    '.h5p-hub-lightbox',
    '.h5p-filter-modal',
    '.h5p-downloading-modal-overlay',
    '.h5p-confirmation-dialog',
    '.h5p-confirmation-dialog-background',
    '.h5p-add-dialog.h5p-open',
  ];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((node) => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
  }

  document.body.classList.remove('h5p-editor-image-popup');

  document.documentElement.classList.remove(
    'h5p-editor-dialog-open',
    'h5p-editor-viewport-lock'
  );

  releaseH5pEditorViewportLock();

  ensureH5pHostShellWidthFix();

  restoreAppRootAccessibility();

  if (typeof window !== 'undefined') {
    window.h5pIsInitialized = false;
  }
}

/** MUI can leave #root aria-hidden after a interrupted dialog close / route change. */
function restoreAppRootAccessibility() {
  const root = document.getElementById('root');
  if (!root) return;

  const openModal = document.querySelector(
    '.MuiDialog-root[aria-hidden="false"], .MuiModal-root[aria-hidden="false"]'
  );
  const h5pDialog = document.querySelector('.h5p-editor-mui-dialog');

  if (!openModal && !h5pDialog) {
    root.removeAttribute('aria-hidden');
    root.removeAttribute('inert');
  }

  if (!document.querySelector('.MuiDialog-root') && !document.querySelector('.MuiModal-root')) {
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  }
}

/** Run after the MUI close transition so we do not fight React's Portal teardown. */
export function scheduleH5pEditorDomCleanup() {
  if (typeof window === 'undefined') return;
  window.setTimeout(cleanupH5pEditorDomArtifacts, 0);
}
