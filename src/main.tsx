import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Intercept benign cross-origin "Script error.", GSI FedCM iframe notices, and React script tag warnings in iframe environments
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('google_client_id');
  } catch (_) {}

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        if (reg.active?.scriptURL?.includes('coi-serviceworker') || reg.installing?.scriptURL?.includes('coi-serviceworker') || reg.waiting?.scriptURL?.includes('coi-serviceworker')) {
          reg.unregister();
        }
      }
    }).catch(() => {});
  }

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  console.error = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : String(a?.message || '')).join(' ');
    if (
      msg.includes('Encountered a script tag while rendering React component') ||
      msg.includes('Script error.') ||
      msg.includes('identity-credentials-get') ||
      msg.includes('[GSI_LOGGER]') ||
      msg.includes('FedCM')
    ) {
      return;
    }
    originalConsoleError.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : String(a?.message || '')).join(' ');
    if (
      msg.includes('identity-credentials-get') ||
      msg.includes('[GSI_LOGGER]') ||
      msg.includes('FedCM')
    ) {
      return;
    }
    originalConsoleWarn.apply(console, args);
  };

  window.addEventListener('error', (event) => {
    const msg = String(event.message || '');
    if (
      msg === 'Script error.' ||
      (!event.message && !event.filename) ||
      msg.includes('identity-credentials-get') ||
      msg.includes('[GSI_LOGGER]') ||
      msg.includes('FedCM')
    ) {
      event.preventDefault();
      return true;
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reasonMsg = String(event.reason?.message || event.reason || '');
    if (
      reasonMsg.includes('Script error') ||
      reasonMsg.includes('gsi') ||
      reasonMsg.includes('GSI') ||
      reasonMsg.includes('ResizeObserver') ||
      reasonMsg.includes('identity-credentials-get') ||
      reasonMsg.includes('FedCM')
    ) {
      event.preventDefault();
      return;
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
