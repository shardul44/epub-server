/**
 * useMediaActions — encapsulates all media asset mutations.
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { queryKeys } from '../lib/queryKeys';
import { useListScope } from '../context/ListScopeContext';
import { removeMediaFromListCache } from '../lib/syncMediaCaches';
import { useMediaAssetsQuery } from './queries/useMediaAssetsQuery';
import useAppDispatch from './useAppDispatch';
import {
  setUploadError,
  clearUploadError,
  setShowUpload,
} from '../features/mediaLibrary/mediaLibrarySlice';

export function useMediaActions() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const listScope = useListScope();
  const { refresh } = useMediaAssetsQuery({ enabled: false });

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

  const handleDelete = useCallback(async (asset) => {
    dispatch(clearUploadError());
    try {
      await api.delete(`/media/${asset.id}`);
      removeMediaFromListCache(queryClient, listScope, asset.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all() });
    } catch (err) {
      dispatch(setUploadError(err.message || 'Failed to delete asset'));
    }
  }, [dispatch, queryClient, listScope]);

  const handleDownload = useCallback((asset) => {
    const url = asset.url || asset.thumbnailUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = asset.filename || asset.name || 'asset';
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.click();
  }, []);

  return { handleUpload, handleDelete, handleDownload };
}
