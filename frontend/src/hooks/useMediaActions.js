/**
 * useMediaActions — encapsulates all media asset mutations.
 *
 * Extracts upload / delete / download logic from MediaLibrary.jsx
 * so the page component only handles rendering.
 *
 * Uses:
 *   - Redux dispatch for UI state (uploadError, showUpload)
 *   - useMediaAssetsQuery.refresh() to invalidate the shared cache
 *   - useQueryClient for optimistic delete
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { queryKeys } from '../lib/queryKeys';
import { useMediaAssetsQuery } from './queries/useMediaAssetsQuery';
import useAppDispatch from './useAppDispatch';
import {
  setUploadError,
  clearUploadError,
  setShowUpload,
} from '../features/mediaLibrary/mediaLibrarySlice';

export function useMediaActions() {
  const dispatch     = useAppDispatch();
  const queryClient  = useQueryClient();
  const { refresh }  = useMediaAssetsQuery({ enabled: false }); // don't auto-fetch here

  /* ── Upload ── */
  const handleUpload = useCallback(async (files) => {
    dispatch(clearUploadError());
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        await api.post('/media/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      dispatch(setShowUpload(false));
      await refresh();
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Upload failed. Please try again.';
      dispatch(setUploadError(msg));
    }
  }, [dispatch, refresh]);

  /* ── Delete ── */
  const handleDelete = useCallback(async (asset) => {
    dispatch(clearUploadError());
    try {
      await api.delete(`/media/${asset.id}`);
      // Optimistic update — remove from cache immediately
      queryClient.setQueryData(queryKeys.media.list(), (prev) =>
        Array.isArray(prev) ? prev.filter((a) => a.id !== asset.id) : prev
      );
      // Then invalidate so next navigation gets fresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.media.list() });
    } catch (err) {
      dispatch(setUploadError(err.message || 'Failed to delete asset'));
    }
  }, [dispatch, queryClient]);

  /* ── Download ── */
  const handleDownload = useCallback((asset) => {
    const url = asset.url || asset.thumbnailUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href     = url;
    a.download = asset.filename || asset.name || 'asset';
    a.target   = '_blank';
    a.rel      = 'noreferrer';
    a.click();
  }, []);

  return { handleUpload, handleDelete, handleDownload };
}
