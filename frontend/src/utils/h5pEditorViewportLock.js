/**
 * While the H5P Create/Edit dialog is open, keep the host page from shrink-wrapping
 * (~960px from H5P application.css on html/body).
 */

const LOCK_CLASS = 'h5p-editor-viewport-lock';

const WIDTH_PROPS = ['width', 'max-width', 'min-width'];

function clearInlineWidth(el) {
  if (!el) return;
  for (const prop of WIDTH_PROPS) {
    el.style.removeProperty(prop);
  }
}

export function applyH5pEditorViewportLock() {
  if (typeof document === 'undefined') return;

  document.documentElement.classList.add(LOCK_CLASS);
}

export function releaseH5pEditorViewportLock() {
  if (typeof document === 'undefined') return;

  document.documentElement.classList.remove(LOCK_CLASS);

  const body = document.body;
  const root = document.getElementById('root');
  clearInlineWidth(document.documentElement);
  clearInlineWidth(body);
  clearInlineWidth(root);

  if (!document.querySelector('.MuiDialog-root')) {
    body.style.removeProperty('overflow');
  }
}

/** One-shot lock while the dialog is open (no rAF loop). */
export function startH5pEditorViewportLockLoop() {
  applyH5pEditorViewportLock();
  return () => {
    releaseH5pEditorViewportLock();
  };
}
