import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Intercept benign cross-origin "Script error." and React script tag warnings in iframe environments,
// as well as benign LiteRT WebAssembly / Emscripten C++ runtime diagnostic messages.
function isBenignLiteRtLog(msg: string): boolean {
  return (
    msg.includes('INFO: [') ||
    msg.includes('WARNING: [') ||
    msg.startsWith('INFO:') ||
    msg.startsWith('WARNING:') ||
    msg.includes('environment.cc') ||
    msg.includes('npu_registry.cc') ||
    msg.includes('accelerator_registry.cc') ||
    msg.includes('gpu_registry.cc') ||
    msg.includes('cpu_registry.cc') ||
    msg.includes('compiled_model.cc') ||
    msg.includes('RegisterAccelerator') ||
    msg.includes('XNNPACK') ||
    msg.includes('delegate for CPU') ||
    msg.includes('Statically linked GPU accelerator') ||
    msg.includes('Creating LiteRT environment') ||
    msg.includes('Flatbuffer model initialized') ||
    msg.includes('litert_tensor_buffer') ||
    msg.includes('odml/litert') ||
    msg.includes('third_party/odml')
  );
}

if (typeof window !== 'undefined') {
  // Pre-configure Emscripten Module.printErr to route LiteRT WASM stdout/stderr to console.debug
  const g = window as any;
  g.Module = g.Module || {};
  const origPrintErr = g.Module.printErr;
  g.Module.printErr = (text: any, ...rest: any[]) => {
    const str = String(text || '');
    if (isBenignLiteRtLog(str)) {
      console.debug('[LiteRT WASM]', text, ...rest);
      return;
    }
    if (origPrintErr) origPrintErr(text, ...rest);
    else console.warn('[LiteRT WASM]', text, ...rest);
  };

  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : String(a?.message || '')).join(' ');
    if (
      msg.includes('Encountered a script tag while rendering React component') ||
      msg.includes('Script error.') ||
      isBenignLiteRtLog(msg)
    ) {
      if (isBenignLiteRtLog(msg)) {
        console.debug('[LiteRT]', ...args);
      }
      return;
    }
    originalConsoleError.apply(console, args);
  };

  const originalConsoleWarn = console.warn;
  console.warn = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'string' ? a : String(a?.message || '')).join(' ');
    if (isBenignLiteRtLog(msg)) {
      console.debug('[LiteRT]', ...args);
      return;
    }
    originalConsoleWarn.apply(console, args);
  };

  window.addEventListener('error', (event) => {
    const msg = String(event.message || '');
    if (msg === 'Script error.' || (!event.message && !event.filename) || isBenignLiteRtLog(msg)) {
      event.preventDefault();
      return true;
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reasonMsg = String(event.reason?.message || event.reason || '');
    if (
      reasonMsg.includes('Script error') ||
      reasonMsg.includes('gsi') ||
      reasonMsg.includes('ResizeObserver') ||
      isBenignLiteRtLog(reasonMsg)
    ) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
