/**
 * audioSyncSlice.js — Redux UI state for Audio Sync Studio.
 *
 * Server data (jobs) lives in React Query (useConversionsQuery).
 * This slice owns only UI state that should survive navigation:
 *   - selectedJobId   — which job is open in the studio
 *   - voiceProfile    — selected TTS voice
 *   - readingSpeed    — TTS speed slider value
 *   - pitch           — TTS pitch slider value
 *   - error           — last error message
 */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  selectedJobId: null,
  voiceProfile:  'Aurora - Female - Warm',
  readingSpeed:  1.0,
  pitch:         1.0,
  error:         '',
};

const audioSyncSlice = createSlice({
  name: 'audioSync',
  initialState,
  reducers: {
    setSelectedJobId(state, action) { state.selectedJobId = action.payload; },
    setVoiceProfile(state, action)  { state.voiceProfile  = action.payload; },
    setReadingSpeed(state, action)  { state.readingSpeed  = action.payload; },
    setPitch(state, action)         { state.pitch         = action.payload; },
    setError(state, action)         { state.error         = action.payload; },
    clearError(state)               { state.error         = ''; },
    resetAudioSyncUI()              { return initialState; },
  },
});

export const {
  setSelectedJobId,
  setVoiceProfile,
  setReadingSpeed,
  setPitch,
  setError,
  clearError,
  resetAudioSyncUI,
} = audioSyncSlice.actions;

export const selectASSSelectedJobId = (s) => s.audioSync.selectedJobId;
export const selectASSVoiceProfile  = (s) => s.audioSync.voiceProfile;
export const selectASSReadingSpeed  = (s) => s.audioSync.readingSpeed;
export const selectASSPitch         = (s) => s.audioSync.pitch;
export const selectASSError         = (s) => s.audioSync.error;

export default audioSyncSlice.reducer;
