/**
 * dashboardSlice.js
 *
 * All dashboard data (stats, jobs, throughput) is now fetched via
 * useDashboardQuery (React Query). This slice is kept only for
 * setSeatLimit which OrgDashboard dispatches after reading the user object.
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  teamData: { members: [], seatLimit: null, seatUsed: 0 },
};

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    setSeatLimit(state, action) {
      state.teamData.seatLimit = action.payload;
    },
    resetDashboard() {
      return initialState;
    },
  },
});

export const { setSeatLimit, resetDashboard } = dashboardSlice.actions;

// Selectors — kept for any remaining consumers; return safe defaults
export const selectTeamData = (state) => state.dashboard.teamData;

export default dashboardSlice.reducer;
