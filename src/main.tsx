import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Intercept benign cross-origin "Script error." and React script tag warnings in iframe environments
if (typeof window !== 'undefined') {
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : String(a?.message || '')).join(' ');
    if (
      msg.includes('Encountered a script tag while rendering React component') ||
      msg.includes('Script error.')
    ) {
      return;
    }
    originalConsoleError.apply(console, args);
  };

  window.addEventListener('error', (event) => {
    const msg = String(event.message || '');
    if (msg === 'Script error.' || (!event.message && !event.filename)) {
      event.preventDefault();
      return true;
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reasonMsg = String(event.reason?.message || event.reason || '');
    if (
      reasonMsg.includes('Script error') ||
      reasonMsg.includes('gsi') ||
      reasonMsg.includes('ResizeObserver')
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
