import React, { useEffect, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { defineElements } from '@lumieducation/h5p-webcomponents';
import { h5pService, getH5pBaseUrl } from '../../../services/h5pService';

defineElements('h5p-editor');

export default function H5pEditorDialog({
  open,
  onClose,
  contentType,
  existingH5pContentId = null,
  existingDbId = null,
  onSaved
}) {
  const editorRef = useRef(null);
  const dbIdRef = useRef(existingDbId);
  const contentIdRef = useRef(existingH5pContentId || 'new');
  const [contentId, setContentId] = useState(existingH5pContentId || 'new');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editorReady, setEditorReady] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    dbIdRef.current = existingDbId;
    const initial = existingH5pContentId || 'new';
    contentIdRef.current = initial;
    setContentId(initial);
  }, [existingDbId, existingH5pContentId]);

  useEffect(() => {
    if (!open) {
      setEditorReady(false);
      setDraftReady(false);
      setError('');
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    setEditorReady(false);
    setDraftReady(false);

    (async () => {
      try {
        const startId = existingH5pContentId || 'new';
        const data = await h5pService.getEditorModel(startId, {
          machineName: contentType?.machineName
        });
        if (cancelled) return;
        const cid = String(data.contentId || '');
        if (!cid || cid === 'new') {
          throw new Error('Server did not return a valid H5P content id');
        }
        contentIdRef.current = cid;
        setContentId(cid);
        if (data.dbId != null) dbIdRef.current = data.dbId;
        setDraftReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(e?.response?.data?.error || e.message || 'Failed to open H5P editor');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, contentType?.machineName, existingH5pContentId]);

  useEffect(() => {
    if (!open || loading || !draftReady || !contentId || contentId === 'new') return undefined;

    const el = editorRef.current;
    if (!el) return undefined;

    const h5pUrl = getH5pBaseUrl();
    el.setAttribute('h5p-url', h5pUrl);
    el.setAttribute('content-id', String(contentId));

    const onSaveError = (event) => {
      setError(event.detail?.message || 'H5P editor error');
    };

    el.addEventListener('save-error', onSaveError);
    el.addEventListener('validation-error', onSaveError);

    el.loadContentCallback = async (cid) => {
      const resolved =
        cid === undefined || cid === null || cid === 'new'
          ? contentIdRef.current
          : String(cid);
      const requestId = resolved && resolved !== 'new' ? resolved : 'new';
      const data = await h5pService.getEditorModel(requestId, {
        machineName: requestId === 'new' ? contentType?.machineName : undefined
      });
      if (data.dbId != null) dbIdRef.current = data.dbId;
      if (data.contentId) {
        contentIdRef.current = String(data.contentId);
        setContentId(String(data.contentId));
      }
      return data.model;
    };

    el.saveContentCallback = async (cid, body) => {
      const payload = {
        library: body.library,
        params: body.params,
        metadata: body.metadata,
        title: body.metadata?.title || contentType?.label
      };

      const h5pCid =
        cid && cid !== 'new' ? String(cid) : contentIdRef.current !== 'new' ? contentIdRef.current : null;
      let row;

      if (dbIdRef.current) {
        row = await h5pService.updateContent(dbIdRef.current, payload);
      } else if (h5pCid) {
        row = await h5pService.updateContent(h5pCid, payload);
        if (row?.id) dbIdRef.current = row.id;
      } else {
        row = await h5pService.createContent(payload);
        dbIdRef.current = row.id;
      }

      const savedId = String(row.h5pContentId || h5pCid || cid);
      contentIdRef.current = savedId;
      setContentId(savedId);
      el.setAttribute('content-id', savedId);

      return {
        contentId: savedId,
        metadata: row.metadataJson || body.metadata
      };
    };

    setEditorReady(true);

    return () => {
      el.removeEventListener('save-error', onSaveError);
      el.removeEventListener('validation-error', onSaveError);
    };
  }, [open, loading, draftReady, contentId, contentType]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await editorRef.current?.save();
      if (onSaved && result) {
        onSaved({
          h5pContentId: result.contentId,
          dbId: dbIdRef.current,
          title: result.metadata?.title || contentType?.label,
          libraryName: contentType?.machineName,
          metadata: result.metadata
        });
      }
      onClose();
    } catch (e) {
      const msg = e?.message || e?.response?.data?.error || 'Save failed';
      if (!String(msg).includes('save-error')) {
        setError(msg.replace(/^save-error:\s*/i, ''));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      <DialogTitle>
        {existingH5pContentId ? 'Edit' : 'Create'}: {contentType?.label || 'H5P content'}
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 480, p: 0 }}>
        {contentType?.hint ? (
          <Alert severity="info" sx={{ m: 2, mb: 0 }}>
            {contentType.hint}
          </Alert>
        ) : null}
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : draftReady && contentId && contentId !== 'new' ? (
          <Box
            sx={{
              minHeight: contentType?.machineName === 'H5P.CoursePresentation' ? 560 : 420,
              p: 1,
            }}
          >
            <h5p-editor
              ref={editorRef}
              content-id={String(contentId)}
              h5p-url={getH5pBaseUrl()}
              style={{
                width: '100%',
                minHeight: contentType?.machineName === 'H5P.CoursePresentation' ? 520 : 400,
                display: 'block',
              }}
            />
            {!editorReady && !error ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={28} />
              </Box>
            ) : null}
          </Box>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={loading || saving || !contentId || !editorReady}
        >
          {saving ? 'Saving…' : 'Save & insert'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
