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
        targets: ['chrome >= 49', 'firefox >= 52', 'safari >= 9', 'ios_saf >= 9', 'edge >= 15'],
        additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      }),
    ],
    esbuild: {
      target: 'es2015',
    },
    build: {
      target: 'es2015',
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dropzone'],
      esbuildOptions: {
        target: 'es2015',
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});