/**
 * epubSlice.js
 *
 * Handles upload state and reader UI state only.
 * Job/conversion data is fetched exclusively via useConversionsQuery (React Query).
 * fetchConversionJobs thunk has been removed — it was never dispatched.
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { pdfService } from '../../services/pdfService';
import { conversionService } from '../../services/conversionService';

/* ─── uploadPdf thunk ─────────────────────────────────────────── */
export const uploadPdf = createAsyncThunk(
  'epub/uploadPdf',
  async ({ file, layoutType = 'REFLOWABLE' }, { rejectWithValue }) => {
    try {
      return await pdfService.uploadPdf(file, layoutType);
    } catch (err) {
      return rejectWithValue(
        err.response?.data?.error || err.response?.data?.message || err.message || 'Upload failed'
      );
    }
  }
);

/* ─── startConversion thunk ───────────────────────────────────── */
export const startConversion = createAsyncThunk(
  'epub/startConversion',
  async ({ pdfDocumentId, options = {} }, { rejectWithValue }) => {
    try {
      return await conversionService.startConversion(pdfDocumentId, options);
    } catch (err) {
      return rejectWithValue(err.response?.data?.error || err.message || 'Failed to start conversion');
    }
  }
);

/* ─── Slice ───────────────────────────────────────────────────── */
const initialState = {
  upload: {
    status:          'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    progress:        0,
    error:           null,
    lastUploadedDoc: null,
  },
  reader: {
    currentJobId:    null,
    currentSection:  null,
    zoom:            1,
    theme:           'light',
  },
  focusedJobId: null,
};

const epubSlice = createSlice({
  name: 'epub',
  initialState,
  reducers: {
    setUploadProgress(state, action) { state.upload.progress = action.payload; },
    resetUpload(state)               { state.upload = initialState.upload; },
    setReaderJob(state, action)      { state.reader.currentJobId = action.payload; },
    setReaderSection(state, action)  { state.reader.currentSection = action.payload; },
    setReaderZoom(state, action)     { state.reader.zoom = action.payload; },
    setReaderTheme(state, action)    { state.reader.theme = action.payload; },
    setFocusedJob(state, action)     { state.focusedJobId = action.payload; },
    clearFocusedJob(state)           { state.focusedJobId = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(uploadPdf.pending,   (state) => { state.upload.status = 'loading';   state.upload.error = null; state.upload.progress = 0; })
      .addCase(uploadPdf.fulfilled, (state, action) => { state.upload.status = 'succeeded'; state.upload.progress = 100; state.upload.lastUploadedDoc = action.payload; })
      .addCase(uploadPdf.rejected,  (state, action) => { state.upload.status = 'failed';    state.upload.progress = 0;   state.upload.error = action.payload; });
  },
});

export const {
  setUploadProgress, resetUpload,
  setReaderJob, setReaderSection, setReaderZoom, setReaderTheme,
  setFocusedJob, clearFocusedJob,
} = epubSlice.actions;

/* ─── Selectors ───────────────────────────────────────────────── */
export const selectUploadStatus    = (s) => s.epub.upload.status;
export const selectUploadProgress  = (s) => s.epub.upload.progress;
export const selectUploadError     = (s) => s.epub.upload.error;
export const selectLastUploadedDoc = (s) => s.epub.upload.lastUploadedDoc;
export const selectUploadLoading   = (s) => s.epub.upload.status === 'loading';
export const selectReaderState     = (s) => s.epub.reader;
export const selectFocusedJobId    = (s) => s.epub.focusedJobId;

export default epubSlice.reducer;
