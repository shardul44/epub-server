import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { defineElements } from '@lumieducation/h5p-webcomponents';
import { h5pService, getH5pBaseUrl } from '../../../services/h5pService';

defineElements('h5p-player');

export default function H5pPlayerEmbed({ h5pContentId, title = 'Interactive content', minHeight = 320 }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  const [playbackWarning, setPlaybackWarning] = useState('');
  const [loading, setLoading] = useState(true);

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

    const onLoaded = () => {
      if (!cancelled) setLoading(false);
    };
    const onError = () => {
      if (!cancelled) {
        setError('Unable to load H5P player content.');
        setLoading(false);
      }
    };

    el.addEventListener('initialized', onLoaded);
    el.addEventListener('xAPI', onLoaded);
    el.addEventListener('load-error', onError);

    return () => {
      cancelled = true;
      el.removeEventListener('initialized', onLoaded);
      el.removeEventListener('xAPI', onLoaded);
      el.removeEventListener('load-error', onError);
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
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      )}
      {error ? (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      ) : null}
      <h5p-player ref={ref} content-id={String(h5pContentId)} h5p-url={getH5pBaseUrl()} style={{ minHeight }} />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {title}
      </Typography>
    </Box>
  );
}
