import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({mode}) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'no-bundle-wasm',
        generateBundle(_, bundle) {
          for (const fileName in bundle) {
            if (fileName.endsWith('.wasm')) {
              console.log(`[Vite no-bundle-wasm] Stripping ${fileName} from static assets bundle (hosted on R2)`);
              delete bundle[fileName];
            }
          }
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dropzone'],
      exclude: ['onnxruntime-web', 'onnxruntime-web/wasm', 'onnxruntime-web/webgpu']
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});