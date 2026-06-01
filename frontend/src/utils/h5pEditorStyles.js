/**
 * Inject H5P editor/player stylesheets (deduped by URL).
 * The h5p-editor web component loads scripts only; we must load styles ourselves.
 */

const OVERRIDE_STYLE_ID = 'h5p-editor-layout-overrides';
const HOST_SHELL_FIX_ID = 'h5p-host-shell-width-fix';

/** Beats H5P application.css `html, body { max-width: 960px }` after the editor dialog closes. */
const HOST_SHELL_WIDTH_FIX_CSS = `
html,
body,
#root,
.layout--org-admin,
.layout--user,
.main-content--org-admin,
.main-content--user,
.iee-shell {
  max-width: none !important;
  width: 100% !important;
  box-sizing: border-box;
}
`;

export function ensureH5pHostShellWidthFix(target = document.head) {
  if (!target || typeof document === 'undefined') return;

  let el = document.getElementById(HOST_SHELL_FIX_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = HOST_SHELL_FIX_ID;
    el.type = 'text/css';
    el.textContent = HOST_SHELL_WIDTH_FIX_CSS;
    target.appendChild(el);
    return;
  }
  if (target.lastElementChild !== el) {
    target.appendChild(el);
  }
}
const IFRAME_OVERRIDE_STYLE_ID = 'h5p-editor-iframe-layout-overrides';

/** Neutralize H5P application.css 960px / 918px caps inside the Create/Edit dialog. */
const LAYOUT_OVERRIDE_CSS = `
html.h5p-editor-dialog-open,
html.h5p-editor-viewport-lock,
html.h5p-editor-dialog-open body,
html.h5p-editor-viewport-lock body {
  max-width: none !important;
  width: 100% !important;
}

.h5p-editor-mui-dialog .h5p-editor-dialog-host,
.h5p-editor-mui-dialog .h5p-editor-dialog-host h5p-editor,
.h5p-editor-mui-dialog .h5p-editor-dialog-host .h5p-create,
.h5p-editor-mui-dialog .h5p-editor-dialog-host .h5p-editor,
.h5p-editor-mui-dialog .h5p-editor-dialog-host .h5peditor,
.h5p-editor-mui-dialog .h5p-editor-dialog-host .h5p-editor-iframe,
.h5p-editor-mui-dialog .h5p-editor-dialog-host iframe.h5p-editor-iframe {
  width: 100% !important;
  max-width: none !important;
  box-sizing: border-box;
}

.h5p-editor-mui-dialog .h5p-editor-dialog-host iframe.h5p-editor-iframe {
  min-height: 360px !important;
  display: block !important;
}

.h5p-editor-mui-dialog .h5p-editor-dialog-host .h5peditor-form.h5peditor-form-manager > .tree,
.h5p-editor-mui-dialog .h5p-editor-dialog-host .h5peditor-form.h5peditor-form-manager > .common,
.h5p-editor-mui-dialog .h5p-editor-dialog-host .h5peditor-form.h5peditor-form-manager > .field {
  max-width: none !important;
  width: 100% !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
}

.h5p-editor-mui-dialog .h5p-editor-dialog-host .h5p-hub,
.h5p-editor-mui-dialog .h5p-hub .h5p-hub-tab-panel,
.h5p-editor-mui-dialog .h5p-hub .h5p-hub-panel,
.h5p-editor-mui-dialog .h5p-hub .h5p-hub-content-list,
.h5p-editor-mui-dialog .h5p-hub [role="tabpanel"],
body > .h5p-hub-lightbox .h5p-hub,
body > .h5p-hub-lightbox .h5p-hub-lightbox-inner {
  width: 100% !important;
  max-width: none !important;
  box-sizing: border-box;
}
`;

const IFRAME_OVERRIDE_CSS = `
html, body {
  max-width: none !important;
  width: 100% !important;
  margin: 0;
  box-sizing: border-box;
}
body > .h5p-editor,
.h5p-editor,
.h5peditor,
.h5p-hub {
  width: 100% !important;
  max-width: none !important;
  box-sizing: border-box;
}
.h5p-editor-iframe {
  width: 100% !important;
  max-width: none !important;
  min-height: 360px !important;
  display: block !important;
}
.h5peditor-form.h5peditor-form-manager > .tree,
.h5peditor-form.h5peditor-form-manager > .common,
.h5peditor-form.h5peditor-form-manager > .field {
  max-width: none !important;
  width: 100% !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
}
.h5p-hub .h5p-hub-tab-panel,
.h5p-hub .h5p-hub-panel,
.h5p-hub .h5p-hub-content-list,
.h5p-hub [role="tabpanel"],
.h5p-hub .h5p-hub-filter-bar,
.h5p-hub .h5p-hub-list.h5p-hub-grid,
.h5p-hub .h5p-hub-list.h5p-hub-tabular {
  width: 100% !important;
  max-width: none !important;
  box-sizing: border-box;
}
`;

const iframeLoadListeners = new WeakSet();

export function injectH5pStyles(styles, target = document.head) {
  if (!Array.isArray(styles) || !target) return;
  const existing = Array.from(target.querySelectorAll('link[data-h5p-href]')).map(
    (el) => el.dataset.h5pHref
  );
  for (const url of styles) {
    if (!url || existing.includes(url)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.type = 'text/css';
    link.dataset.h5pHref = url;
    link.addEventListener(
      'load',
      () => {
        injectH5pEditorLayoutOverrides(target);
        ensureH5pHostShellWidthFix(target);
      },
      { once: true }
    );
    target.appendChild(link);
    existing.push(url);
  }
  injectH5pEditorLayoutOverrides(target);
  ensureH5pHostShellWidthFix(target);
}

export function injectH5pEditorLayoutOverrides(target = document.head) {
  if (!target || typeof document === 'undefined') return;

  let el = document.getElementById(OVERRIDE_STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = OVERRIDE_STYLE_ID;
    el.type = 'text/css';
    el.textContent = LAYOUT_OVERRIDE_CSS;
    target.appendChild(el);
    return;
  }
  if (target.lastElementChild !== el) {
    target.appendChild(el);
  }
}

function appendIframeOverrideStyle(doc) {
  let el = doc.getElementById(IFRAME_OVERRIDE_STYLE_ID);
  if (!el) {
    el = doc.createElement('style');
    el.id = IFRAME_OVERRIDE_STYLE_ID;
    el.type = 'text/css';
    el.textContent = IFRAME_OVERRIDE_CSS;
    doc.head.appendChild(el);
    return;
  }
  if (doc.head && doc.head.lastElementChild !== el) {
    doc.head.appendChild(el);
  }
}

/** H5P editor iframe loads application.css with html,body { max-width: 960px }. */
export function applyH5pEditorIframeLayoutOverrides(iframe) {
  if (!iframe) return;

  const inject = () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc?.head) return;
      appendIframeOverrideStyle(doc);
    } catch {
      // ignore if iframe is not accessible yet
    }
  };

  if (!iframeLoadListeners.has(iframe)) {
    iframe.addEventListener('load', inject);
    iframeLoadListeners.add(iframe);
  }
  inject();
}

export function patchH5pEditorIframes(container) {
  if (!container) return;
  container.querySelectorAll('iframe.h5p-editor-iframe').forEach(applyH5pEditorIframeLayoutOverrides);
  injectH5pEditorLayoutOverrides();
}

/** @deprecated Use patchH5pEditorIframes on editorloaded instead. */
export function watchH5pEditorIframes(container) {
  patchH5pEditorIframes(container);
  return () => {};
}
