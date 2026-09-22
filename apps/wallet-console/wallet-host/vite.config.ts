import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: false,
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    outDir: fileURLToPath(new URL('../../../.release-artifacts/wallet-host', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
