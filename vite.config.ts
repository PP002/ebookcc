import legacy from '@vitejs/plugin-legacy';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({mode}) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      legacy({
        // Target modern + legacy browsers down to BlackBerry 10, Android 4.4+, iOS Safari 9+, Chrome 49+
        targets: [
          'defaults',
          'chrome >= 49',
          'firefox >= 52',
          'safari >= 9',
          'ios_saf >= 9',
          'edge >= 18',
          'bb >= 10',
          'not dead'
        ],
        // Additional polyfills required for legacy browser environments (fetch, async/await generator)
        additionalLegacyPolyfills: ['regenerator-runtime/runtime', 'whatwg-fetch'],
        // Explicitly include essential polyfills injected exclusively into the legacy bundle
        polyfills: [
          'es.promise',
          'es.symbol',
          'es.array.iterator',
          'es.object.assign',
          'es.promise.finally',
          'es.map',
          'es.set',
          'es.array.includes',
          'es.string.includes',
          'es.string.starts-with',
          'es.string.ends-with',
        ],
        // Modern polyfills disabled to ensure zero overhead for modern ESM browsers
        modernPolyfills: false,
        renderModernChunks: true,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dropzone']
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});