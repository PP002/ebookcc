import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function unlayerCSS(css: string): string {
  if (!css || typeof css !== 'string') return css;

  // 1. Remove layer statements like "@layer theme, base, components, utilities;"
  css = css.replace(/@layer\s+[a-zA-Z0-9_,\s-]+;/g, '');

  // 2. Unroll `@layer <name> { ... }`
  let result = '';
  let i = 0;
  while (i < css.length) {
    const layerIdx = css.indexOf('@layer', i);
    if (layerIdx === -1) {
      result += css.slice(i);
      break;
    }

    result += css.slice(i, layerIdx);

    // Find opening brace '{'
    const openBrace = css.indexOf('{', layerIdx);
    if (openBrace === -1) {
      result += css.slice(layerIdx);
      break;
    }

    // Check if between layerIdx and openBrace there is a semicolon ';'
    const semiIdx = css.indexOf(';', layerIdx);
    if (semiIdx !== -1 && semiIdx < openBrace) {
      i = semiIdx + 1;
      continue;
    }

    // Balance braces to find matching closing brace
    let depth = 1;
    let j = openBrace + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }

    const innerContent = css.slice(openBrace + 1, j - 1);
    // Recursively unlayer in case there are nested layers
    result += unlayerCSS(innerContent);
    i = j;
  }
  return result;
}

function unlayerPlugin(): Plugin {
  return {
    name: 'unlayer-css-plugin',
    enforce: 'post',
    transform(code: string, id: string) {
      if (id.endsWith('.css') || id.includes('tailwind') || code.includes('@layer')) {
        return {
          code: unlayerCSS(code),
          map: null,
        };
      }
    },
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && typeof file.fileName === 'string' && file.fileName.endsWith('.css')) {
          file.source = unlayerCSS(String(file.source));
        }
      }
    },
  };
}

export default defineConfig(({mode}) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      unlayerPlugin(),
    ],
    esbuild: {
      target: 'es2015',
      legalComments: 'none',
    },
    build: {
      target: 'es2015',
      cssTarget: 'chrome60',
      minify: 'esbuild',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
          },
        },
      },
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
