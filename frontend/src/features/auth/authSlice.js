import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { loginRequest, fetchMeRequest } from './authAPI';

/* ─── Async thunks ────────────────────────────────────────────── */

/**
 * loginUser — authenticates with the backend, persists the token,
 * and returns the user object.
 */
export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async (credentials, { rejectWithValue }) => {
    try {
      const data = await loginRequest(credentials);
      const token = data?.token ?? data?.data?.token;
      const user  = data?.user  ?? data?.data?.user ?? data?.data;
      if (token) localStorage.setItem('token', token);
      return user;
    } catch (err) {
      const message =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Login failed';
      return rejectWithValue(message);
    }
  }
);

/**
 * refreshUser — re-fetches /auth/me to keep the user object fresh.
 *
 * Guards:
 *  - Skips if no token is present.
 *  - Skips if a fetch is already in-flight (status === 'loading'), preventing
 *    duplicate calls from Strict Mode double-invocation and Layout route changes.
 */
export const refreshUser = createAsyncThunk(
  'auth/refreshUser',
  async (_, { rejectWithValue }) => {
    const token = localStorage.getItem('token');
    if (!token) return rejectWithValue('No token');
    try {
      return await fetchMeRequest();
    } catch (err) {
      localStorage.removeItem('token');
      return rejectWithValue(err.message || 'Session expired');
    }
  },
  {
    // Skip if a refresh is already in-flight AND we already have a user —
    // this prevents duplicate calls from Strict Mode double-invocation and
    // Layout route-change effects, while still allowing the initial boot call
    // (where status starts as 'loading' but user is null).
    condition: (_, { getState }) => {
      const { status, user } = getState().auth;
      // Allow the call if we don't have a user yet (initial boot)
      if (!user) return true;
      // Block duplicate in-flight calls once a user is loaded
      return status !== 'loading';
    },
  }
);

/* ─── Slice ───────────────────────────────────────────────────── */

const initialState = {
  user: null,
  /**
   * 'idle'      — before any auth check has started (treated as loading on boot)
   * 'loading'   — /auth/me in-flight
   * 'succeeded' — user is authenticated
   * 'failed'    — no valid session
   *
   * Initialised to 'loading' so RequireAuthLayout waits for the first
   * /auth/me response before deciding to redirect. Without this, Redux
   * resets to null on every page refresh and the guard redirects to /login
   * before the token can be validated.
   */
  status: 'loading',
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** Directly set the user (e.g. after profile update). */
    setUser(state, action) {
      state.user = action.payload;
    },
    /** Clear auth state and remove the persisted token. */
    logout(state) {
      state.user   = null;
      state.status = 'idle';
      state.error  = null;
      localStorage.removeItem('token');
    },
    /** Clear any auth error (e.g. when the login form is reset). */
    clearAuthError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // ── loginUser ──────────────────────────────────────────────
    builder
      .addCase(loginUser.pending, (state) => {
        state.status = 'loading';
        state.error  = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.user   = action.payload;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.status = 'failed';
        state.error  = action.payload;
      });

    // ── refreshUser ────────────────────────────────────────────
    builder
      .addCase(refreshUser.pending, (state) => {
        // Only show loading on first boot (when user is null)
        if (!state.user) state.status = 'loading';
      })
      .addCase(refreshUser.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.user   = action.payload;
      })
      .addCase(refreshUser.rejected, (state) => {
        state.status = 'failed';
        state.user   = null;
      });
  },
});

export const { setUser, logout, clearAuthError } = authSlice.actions;

/* ─── Selectors ───────────────────────────────────────────────── */
export const selectUser          = (state) => state.auth.user;
export const selectAuthStatus    = (state) => state.auth.status;
export const selectAuthError     = (state) => state.auth.error;
export const selectAuthLoading   = (state) => state.auth.status === 'loading';
export const selectIsAuthenticated = (state) => !!state.auth.user;

export default authSlice.reducer;
