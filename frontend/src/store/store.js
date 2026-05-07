import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../features/auth/authSlice';
import dashboardReducer from '../features/dashboard/dashboardSlice';
import epubReducer from '../features/epub/epubSlice';
import pdfsReducer from '../features/pdfs/pdfsSlice';

const store = configureStore({
  reducer: {
    auth: authReducer,
    dashboard: dashboardReducer,
    epub: epubReducer,
    pdfs: pdfsReducer,
  },
  // Redux DevTools is enabled automatically in development.
  // Thunk middleware is included by default via configureStore.
  devTools: import.meta.env.DEV,
});

export default store;
