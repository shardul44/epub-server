import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { pdfService } from '../../services/pdfService';

/* ─── Async thunk ─────────────────────────────────────────────── */

/**
 * fetchPdfs — loads the full PDF list from GET /pdfs.
 *
 * Guards:
 *  - Skips if a fetch is already in-flight (status === 'loading').
 *  - Skips if data is already loaded (status === 'succeeded') unless
 *    the caller passes `force: true` to explicitly refresh.
 */
export const fetchPdfs = createAsyncThunk(
  'pdfs/fetchPdfs',
  async (_, { rejectWithValue }) => {
    try {
      const data = await pdfService.getAllPdfs();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      return rejectWithValue(err.message || 'Failed to load PDFs');
    }
  },
  {
    condition: (arg, { getState }) => {
      const { status } = getState().pdfs;
      // Allow forced refresh; otherwise skip if already loading or loaded
      if (arg?.force) return true;
      return status !== 'loading' && status !== 'succeeded';
    },
  }
);

/* ─── Slice ───────────────────────────────────────────────────── */

const initialState = {
  items: [],
  /** 'idle' | 'loading' | 'succeeded' | 'failed' */
  status: 'idle',
  error: null,
};

const pdfsSlice = createSlice({
  name: 'pdfs',
  initialState,
  reducers: {
    /** Optimistically remove a PDF after deletion without re-fetching. */
    removePdf(state, action) {
      state.items = state.items.filter((p) => p.id !== action.payload);
    },
    /** Force the slice back to idle so the next usePdfs mount re-fetches. */
    invalidatePdfs(state) {
      state.status = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPdfs.pending, (state) => {
        state.status = 'loading';
        state.error  = null;
      })
      .addCase(fetchPdfs.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items  = action.payload;
      })
      .addCase(fetchPdfs.rejected, (state, action) => {
        state.status = 'failed';
        state.error  = action.payload;
      });
  },
});

export const { removePdf, invalidatePdfs } = pdfsSlice.actions;

/* ─── Selectors ───────────────────────────────────────────────── */
export const selectPdfs        = (state) => state.pdfs.items;
export const selectPdfsLoading = (state) => state.pdfs.status === 'loading';
export const selectPdfsStatus  = (state) => state.pdfs.status;
export const selectPdfsError   = (state) => state.pdfs.error;

export default pdfsSlice.reducer;
