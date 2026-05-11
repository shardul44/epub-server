/**
 * main.jsx — application entry point.
 *
 * Provider order (outer → inner):
 *   StrictMode
 *     Redux Provider     — global state (auth, slices, ui)
 *       QueryClientProvider — server cache
 *         BrowserRouter   — routing context (used by App + AppRouter)
 *           Toaster       — global toast UI driven by uiSlice
 *           App           — error boundary + AppRouter
 *
 * The Toaster lives outside <App /> so it survives any error-boundary
 * fallback render.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider as ReduxProvider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import store from './store/store.js';
import { queryClient } from './lib/queryClient.js';
import App from './App.jsx';
import Toaster from './layouts/Toaster.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <Toaster />
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ReduxProvider>
  </React.StrictMode>,
);
