import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { defineElements } from '@lumieducation/h5p-webcomponents';
import { h5pService, getH5pBaseUrl } from '../../../services/h5pService';
import {
  installH5pAuthGetPathPatch,
  setH5pAuthCookie,
  clearH5pAuthCookie,
  syncH5pAuthToken
} from '../../../utils/h5pAuthGetPath';
import { installH5pPlayerInitPatch } from '../../../utils/h5pPlayerInitPatch';
import { installH5pGlobalInitGuard } from '../../../utils/h5pGlobalInitGuard';

defineElements('h5p-player');
installH5pPlayerInitPatch();
installH5pGlobalInitGuard();

export default function H5pPlayerEmbed({ h5pContentId, title = 'Interactive content', minHeight = 320 }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  const [playbackWarning, setPlaybackWarning] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const clearGetPath = installH5pAuthGetPathPatch();
    const token = localStorage.getItem('token');
    if (token) {
      syncH5pAuthToken(token);
      setH5pAuthCookie(token);
    }
    return () => {
      clearGetPath?.();
      clearH5pAuthCookie();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el || !h5pContentId) return undefined;
    setLoading(true);
    setError('');
    setPlaybackWarning('');

    const h5pUrl = getH5pBaseUrl();
    el.setAttribute('h5p-url', h5pUrl);
    el.setAttribute('content-id', String(h5pContentId));

    el.loadContentCallback = async (contentId) => {
      const data = await h5pService.getPlayerModel(contentId);
      if (!data?.model || !Array.isArray(data.model.scripts) || !Array.isArray(data.model.styles)) {
        throw new Error('Invalid H5P player model');
      }
      const warn = data.warnings?.[0]?.message;
      if (!cancelled && warn) setPlaybackWarning(warn);
      return data.model;
    };

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const onLoaded = finishLoading;
    const onError = () => {
      if (!cancelled) {
        setError('Unable to load H5P player content.');
        setLoading(false);
      }
    };

    el.addEventListener('initialized', onLoaded);
    el.addEventListener('xAPI', onLoaded);

    const timeoutId = window.setTimeout(finishLoading, 15000);

    let observer;
    const observePlayerDom = () => {
      const root = el.shadowRoot || el;
      if (!root) return;
      observer = new MutationObserver(() => {
        if (root.querySelector('.h5p-content, .h5p-iframe-wrapper')) {
          finishLoading();
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      if (root.querySelector('.h5p-content, .h5p-iframe-wrapper')) {
        finishLoading();
      }
    };
    observePlayerDom();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      observer?.disconnect();
      el.removeEventListener('initialized', onLoaded);
      el.removeEventListener('xAPI', onLoaded);
    };
  }, [h5pContentId]);

  if (!h5pContentId) {
    return (
      <Typography variant="body2" color="text.secondary">
        No H5P content linked.
      </Typography>
    );
  }

  return (
    <Box sx={{ position: 'relative', minHeight }}>
      {playbackWarning ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {playbackWarning}
        </Alert>
      ) : null}
      {error ? (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      ) : null}
      <Box sx={{ position: 'relative', minHeight }}>
        {loading ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(255,255,255,0.75)'
            }}
          >
            <CircularProgress size={32} />
          </Box>
        ) : null}
        <h5p-player ref={ref} content-id={String(h5pContentId)} h5p-url={getH5pBaseUrl()} style={{ minHeight }} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {title}
      </Typography>
    </Box>
  );
}
