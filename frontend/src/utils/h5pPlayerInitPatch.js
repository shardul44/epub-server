/**
 * h5p-webcomponents registers a global H5P "initialized" listener per player.
 * Other instances' handlers can run before their iframe exists → contentWindow null.
 */
export function installH5pPlayerInitPatch() {
  if (typeof customElements === 'undefined') return;

  const Ctor = customElements.get('h5p-player');
  if (!Ctor?.prototype?.onContentInitialized) {
    return;
  }
  if (Ctor.prototype.__h5pInitPatchedV2) {
    return;
  }

  Ctor.prototype.onContentInitialized = function patchedOnContentInitialized() {
    const playerModel = this.playerModel;
    if (!playerModel?.contentId) return;

    const divMode = playerModel.embedTypes?.includes('div');
    if (!divMode) {
      const iframe = document.getElementById(`h5p-iframe-${playerModel.contentId}`);
      if (!iframe?.contentWindow) return;
    }

    this.h5pObject = divMode
      ? window.H5P
      : document.getElementById(`h5p-iframe-${playerModel.contentId}`).contentWindow.H5P;
    this.h5pWindow = divMode
      ? window
      : document.getElementById(`h5p-iframe-${playerModel.contentId}`).contentWindow;

    // content-id attribute is often the DB row id; H5P instances use storage id.
    const matchId = playerModel.contentId;
    this.h5pInstance = this.h5pObject?.instances?.find((i) => i.contentId == matchId);
    if (!this.h5pInstance) return;

    this.dispatchEvent(
      new CustomEvent('initialized', { detail: { contentId: this.getAttribute('content-id') } })
    );
    if (window.H5P?.externalDispatcher) {
      window.H5P.externalDispatcher.off('initialized', this.onContentInitialized);
    }
  };
  Ctor.prototype.__h5pInitPatchedV2 = true;
}
