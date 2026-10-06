import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const appRoot = fileURLToPath(new URL('.', import.meta.url));
  const appSrc = `${appRoot}src`;
  const base = process.env.VITE_ASSET_BASE_PATH || '/';
  // The homepage showcase renders the installed SDK release's own wallet
  // surfaces, which the package does not export.
  const walletUi = `${dirname(createRequire(import.meta.url).resolve('@seams/wallet/package.json'))}/dist/esm`;
  return {
    base,
    plugins: [react()],
    server: {
      host: 'localhost',
      port: 4005,
      strictPort: true,
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': appSrc,
        '@core': `${appSrc}/core`,
        '@wallet-product': `${appSrc}/products/wallet`,
        '@app': `${appSrc}/app`,
        '@wallet-ui': walletUi,
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rolldownOptions: {
        input: {
          main: `${appRoot}index.html`,
          showcaseTransaction: `${appRoot}showcase/transaction/index.html`,
          showcaseCheckout: `${appRoot}showcase/checkout/index.html`,
          showcaseCheckoutWallet: `${appRoot}showcase/checkout/wallet/index.html`,
          showcaseMotion: `${appRoot}showcase/motion/index.html`,
        },
      },
    },
  };
});
