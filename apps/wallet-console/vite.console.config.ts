import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot, type ConfigEnv } from 'vite';
import react from '@vitejs/plugin-react';

function consoleConfig({ mode }: ConfigEnv) {
  if (mode !== 'platform' && mode !== 'wallet')
    throw new Error('Select --mode platform or --mode wallet');
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const source = `${directory}src`;
  return {
    root: `${directory}${mode === 'platform' ? 'platform' : 'console'}`,
    envDir: directory,
    publicDir: `${directory}public`,
    cacheDir: `${directory}node_modules/.vite-console-${mode}`,
    base: process.env.VITE_ASSET_BASE_PATH || '/',
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '/src': source,
        '@': source,
        '@core': `${source}/core`,
        '@wallet-product': `${source}/products/wallet`,
        '@app': `${source}/app`,
      },
    },
    server: {
      host: '127.0.0.1',
      port: mode === 'platform' ? 4007 : 4005,
      strictPort: true,
      fs: { allow: [searchForWorkspaceRoot(directory)] },
      proxy: { '/console': { target: 'http://127.0.0.1:4100' } },
    },
    build: { outDir: `${directory}dist-${mode}`, emptyOutDir: true, sourcemap: true },
  };
}

export default defineConfig(consoleConfig);
