/**
 * usageSlice.js
 *
 * Redux slice for Usage page UI state.
 *
 * Server data (license, plans) lives in React Query (useUsageQuery).
 * This slice owns only UI state:
 *   - showUpgrade  — whether the Upgrade Plan modal is open
 *   - showAddOns   — whether the Buy Add-Ons modal is open
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  showUpgrade: false,
  showAddOns:  false,
};

const usageSlice = createSlice({
  name: 'usage',
  initialState,
  reducers: {
    openUpgradeModal(state)  { state.showUpgrade = true; },
    closeUpgradeModal(state) { state.showUpgrade = false; },
    openAddOnsModal(state)   { state.showAddOns  = true; },
    closeAddOnsModal(state)  { state.showAddOns  = false; },
    resetUsageUI()           { return initialState; },
  },
});

export const {
  openUpgradeModal,
  closeUpgradeModal,
  openAddOnsModal,
  closeAddOnsModal,
  resetUsageUI,
} = usageSlice.actions;

/* ─── Selectors ───────────────────────────────────────────────── */
export const selectShowUpgrade = (s) => s.usage.showUpgrade;
export const selectShowAddOns  = (s) => s.usage.showAddOns;

export default usageSlice.reducer;
