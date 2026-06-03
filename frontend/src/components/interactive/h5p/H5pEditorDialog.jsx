import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import {
  injectH5pStyles,
  injectH5pEditorLayoutOverrides,
  patchH5pEditorIframes
} from '../../../utils/h5pEditorStyles';
import {
  installH5pAuthGetPathPatch,
  forceH5pAuthGetPathPatch,
  syncH5pAuthToken,
  setH5pAuthCookie,
  clearH5pAuthCookie
} from '../../../utils/h5pAuthGetPath';
import { installH5pGlobalInitGuard } from '../../../utils/h5pGlobalInitGuard';
import {
  cleanupH5pEditorDomArtifacts,
  scheduleH5pEditorDomCleanup
} from '../../../utils/h5pEditorDomCleanup';
import { startH5pEditorViewportLockLoop } from '../../../utils/h5pEditorViewportLock';
import './H5pEditorDialog.css';

defineElements('h5p-editor');

function applyEditorStyles(model) {
  if (model?.styles?.length) {
    injectH5pStyles(model.styles);
  }
}

export default function H5pEditorDialog({
  open,
  onClose,
  contentType,
  existingH5pContentId = null,
  existingDbId = null,
  onSaved
}) {
  const editorRef = useRef(null);
  const hostRef = useRef(null);
  const onEditorLoadedRef = useRef(() => {});
  const editorLoadedOnceRef = useRef(false);
  const dbIdRef = useRef(existingDbId);
  const contentIdRef = useRef(existingH5pContentId || 'new');
  const [contentId, setContentId] = useState(existingH5pContentId || 'new');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editorReady, setEditorReady] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    const clearAuth = installH5pAuthGetPathPatch();
    const clearGuard = installH5pGlobalInitGuard();
    return () => {
      clearAuth?.();
      clearGuard?.();
    };
  }, []);

  const handleClose = () => {
    onClose();
  };

  useEffect(() => {
    if (!open) return undefined;

    if (typeof window !== 'undefined') {
      window.h5pIsInitialized = false;
    }

    const root = document.documentElement;
    root.classList.add('h5p-editor-dialog-open');
    injectH5pEditorLayoutOverrides();
    const stopLock = startH5pEditorViewportLockLoop();
    return () => {
      root.classList.remove('h5p-editor-dialog-open');
      stopLock();
    };
  }, [open]);

  useEffect(() => {
    if (open) return undefined;
    scheduleH5pEditorDomCleanup();
    return undefined;
  }, [open]);

  useEffect(() => () => cleanupH5pEditorDomArtifacts(), []);

  useEffect(() => {
    if (!open) {
      clearH5pAuthCookie();
      return undefined;
    }
    const token = localStorage.getItem('token');
    if (token) {
      setH5pAuthCookie(token);
      syncH5pAuthToken(token);
      forceH5pAuthGetPathPatch(token);
    }
    return () => clearH5pAuthCookie();
  }, [open]);

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
      editorLoadedOnceRef.current = false;
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
        applyEditorStyles(data.model);
        const bootstrapToken = data.model?.integration?.authToken || localStorage.getItem('token');
        if (bootstrapToken) {
          syncH5pAuthToken(bootstrapToken);
          setH5pAuthCookie(bootstrapToken);
          forceH5pAuthGetPathPatch(bootstrapToken);
        }
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

  onEditorLoadedRef.current = () => {
    if (editorLoadedOnceRef.current) return;
    editorLoadedOnceRef.current = true;
    setEditorReady(true);
    setError('');
    injectH5pEditorLayoutOverrides();
    patchH5pEditorIframes(hostRef.current);
    const editorEl = editorRef.current;
    window.requestAnimationFrame(() => {
      editorEl?.resize?.();
      patchH5pEditorIframes(hostRef.current);
    });
  };

  const bindEditorElement = useCallback(
    (el) => {
      editorRef.current = el;
      if (!el || !draftReady || !contentId || contentId === 'new') return;

      const h5pUrl = getH5pBaseUrl();
      el.setAttribute('h5p-url', h5pUrl);
      el.setAttribute('content-id', String(contentId));

      if (!el.__h5pEditorLoadedBound) {
        el.__h5pEditorLoadedBound = true;
        el.addEventListener('editorloaded', () => onEditorLoadedRef.current());
      }

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
        applyEditorStyles(data.model);
        const authToken = data.model?.integration?.authToken || localStorage.getItem('token');
        if (authToken) {
          syncH5pAuthToken(authToken);
          setH5pAuthCookie(authToken);
          forceH5pAuthGetPathPatch(authToken);
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
    },
    [draftReady, contentId, contentType?.machineName, contentType?.label]
  );

  useEffect(() => {
    if (!open || loading || !draftReady || !contentId || contentId === 'new') return undefined;

    const el = editorRef.current;
    if (!el) return undefined;

    setEditorReady(false);

    const onSaveError = (event) => {
      setError(event.detail?.message || 'H5P editor error');
    };

    el.addEventListener('save-error', onSaveError);
    el.addEventListener('validation-error', onSaveError);

    bindEditorElement(el);

    let polls = 0;
    const pollId = window.setInterval(() => {
      polls += 1;
      const iframe = hostRef.current?.querySelector('iframe.h5p-editor-iframe');
      const doc = iframe?.contentDocument;
      const hasUi =
        doc?.querySelector('.h5peditor .field') ||
        doc?.querySelector('.h5p-hub .h5p-hub-content-list') ||
        doc?.querySelector('.h5p-hub .h5p-hub-panel');
      if (hasUi) {
        onEditorLoadedRef.current();
        window.clearInterval(pollId);
      } else if (polls > 60) {
        window.clearInterval(pollId);
      }
    }, 250);

    return () => {
      window.clearInterval(pollId);
      el.removeEventListener('save-error', onSaveError);
      el.removeEventListener('validation-error', onSaveError);
    };
  }, [open, loading, draftReady, contentId, bindEditorElement]);

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
      handleClose();
    } catch (e) {
      const msg = e?.message || e?.response?.data?.error || 'Save failed';
      if (!String(msg).includes('save-error')) {
        setError(msg.replace(/^save-error:\s*/i, ''));
      }
    } finally {
      setSaving(false);
    }
  };

  const dialog = (
    <Dialog
      className="h5p-editor-mui-dialog"
      open={open}
      onClose={handleClose}
      fullScreen
      scroll="paper"
      disableScrollLock
      disableEnforceFocus
      container={typeof document !== 'undefined' ? document.body : undefined}
      slotProps={{
        root: {
          className: 'h5p-editor-mui-dialog-root',
        },
        backdrop: {
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
          },
        },
        paper: {
          className: 'h5p-editor-mui-dialog-paper',
          sx: {
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: '100%',
            height: '100%',
            maxHeight: '100%',
            margin: 0,
          },
        },
        transition: { onExited: scheduleH5pEditorDomCleanup },
      }}
    >
      <DialogTitle sx={{ flexShrink: 0 }}>
        {existingH5pContentId ? 'Edit' : 'Create'}: {contentType?.label || 'H5P content'}
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          p: 0,
          overflow: 'hidden',
        }}
      >
        {contentType?.hint ? (
          <Alert severity="info" sx={{ m: 2, mb: 0, flexShrink: 0 }}>
            {contentType.hint}
          </Alert>
        ) : null}
        {error && (
          <Alert severity="error" sx={{ m: 2, flexShrink: 0 }}>
            {error}
          </Alert>
        )}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : draftReady && contentId && contentId !== 'new' ? (
          <Box
            ref={hostRef}
            className="h5p-editor-dialog-host"
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              p: 0,
            }}
          >
            <h5p-editor
              key={contentId}
              ref={bindEditorElement}
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
      <DialogActions sx={{ flexShrink: 0 }}>
        <Button onClick={handleClose} disabled={saving}>
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

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
