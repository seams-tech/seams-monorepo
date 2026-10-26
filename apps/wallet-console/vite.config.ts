import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { translate } from './src/marketing/i18n/catalog';
import {
  localeFromUrl,
  pageFromUrl,
  walletPagePath,
  type Locale,
  type WalletPage,
} from './src/marketing/i18n/locale';
import { translate as translateFeatures } from './src/pages/features/catalog';
import { translate as translatePricing } from './src/pages/pricing/catalog';

const walletSiteUrl = new URL(process.env.VITE_WALLET_SITE_ORIGIN || 'https://wallet.seams.sh/');
walletSiteUrl.pathname = `${walletSiteUrl.pathname.replace(/\/$/, '')}/`;

const walletPages: readonly WalletPage[] = ['home', 'pricing', 'features'];
const locales: readonly Locale[] = ['en', 'ja'];

function pageUrl(page: WalletPage, locale: Locale): string {
  return new URL(walletPagePath(walletSiteUrl.pathname, page, locale), walletSiteUrl).href;
}

function normalizePageRoute(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  const url = new URL(request.url || '/', walletSiteUrl);
  if (!/\/(?:ja|pricing|features)$/.test(url.pathname)) {
    next();
    return;
  }
  response.writeHead(301, { Location: `${url.pathname}/${url.search}` });
  response.end();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function pageText(page: WalletPage, language: Locale): { title: string; description: string } {
  if (page === 'pricing') {
    return {
      title: translatePricing(language, 'pricingPageTitle'),
      description: translatePricing(language, 'pricingDescription'),
    };
  }
  if (page === 'features') {
    return {
      title: translateFeatures(language, 'featuresPageTitle'),
      description: translateFeatures(language, 'featuresDescription'),
    };
  }
  return {
    title: translate(language, 'pageTitle'),
    description: translate(language, 'pageDescription'),
  };
}

function languageHtml(html: string, page: WalletPage, language: Locale): string {
  const english = pageUrl(page, 'en');
  const japanese = pageUrl(page, 'ja');
  const canonical = language === 'ja' ? japanese : english;
  const text = pageText(page, language);
  const title = escapeHtml(text.title);
  const description = escapeHtml(text.description);
  const metadata = `
    <meta data-wallet-meta name="description" content="${description}" />
    <link data-wallet-meta rel="canonical" href="${escapeHtml(canonical)}" />
    <link data-wallet-meta rel="alternate" hreflang="en" href="${escapeHtml(english)}" />
    <link data-wallet-meta rel="alternate" hreflang="ja" href="${escapeHtml(japanese)}" />
    <link data-wallet-meta rel="alternate" hreflang="x-default" href="${escapeHtml(english)}" />
    <meta data-wallet-meta property="og:type" content="website" />
    <meta data-wallet-meta property="og:title" content="${title}" />
    <meta data-wallet-meta property="og:description" content="${description}" />
    <meta data-wallet-meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta data-wallet-meta property="og:locale" content="${language === 'ja' ? 'ja_JP' : 'en_US'}" />
    <meta data-wallet-meta property="og:locale:alternate" content="${language === 'ja' ? 'en_US' : 'ja_JP'}" />
    <meta data-wallet-meta name="twitter:card" content="summary" />
    <meta data-wallet-meta name="twitter:title" content="${title}" />
    <meta data-wallet-meta name="twitter:description" content="${description}" />`;
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${language}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/\s*<(?:meta|link) data-wallet-meta[^>]*>/g, '')
    .replace('</head>', `${metadata}\n  </head>`);
}

const walletLanguagePages: Plugin = {
  name: 'wallet-language-pages',
  enforce: 'post',
  configureServer(server) {
    server.middlewares.use(normalizePageRoute);
  },
  configurePreviewServer(server) {
    server.middlewares.use(normalizePageRoute);
  },
  transformIndexHtml(html, context) {
    if (context.path.includes('/showcase/')) {
      return html.replace('</head>', '<meta name="robots" content="noindex" /></head>');
    }
    const url = new URL(context.originalUrl || context.path, walletSiteUrl);
    return languageHtml(html, pageFromUrl(url), localeFromUrl(url));
  },
  generateBundle(_options, bundle) {
    const entry = bundle['index.html'];
    if (!entry || entry.type !== 'asset' || typeof entry.source !== 'string') {
      throw new Error('Wallet marketing build requires index.html');
    }
    const urls: string[] = [];
    this.emitFile({
      type: 'asset',
      fileName: '404.html',
      source: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Page not found | Seams</title>
  </head>
  <body>
    <main>
      <h1>Page not found</h1>
      <p>This address does not match a public page.</p>
      <a href="/">Seams Wallet</a>
    </main>
  </body>
</html>`,
    });
    this.emitFile({
      type: 'asset',
      fileName: 'robots.txt',
      source: `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', walletSiteUrl).href}\n`,
    });
    for (const page of walletPages) {
      const english = escapeHtml(pageUrl(page, 'en'));
      const japanese = escapeHtml(pageUrl(page, 'ja'));
      const alternates = `<xhtml:link rel="alternate" hreflang="en" href="${english}"/><xhtml:link rel="alternate" hreflang="ja" href="${japanese}"/><xhtml:link rel="alternate" hreflang="x-default" href="${english}"/>`;
      for (const locale of locales) {
        // the English home page is the bundle's own index.html
        if (page !== 'home' || locale !== 'en') {
          this.emitFile({
            type: 'asset',
            fileName: `${walletPagePath('', page, locale).slice(1)}index.html`,
            source: languageHtml(entry.source, page, locale),
          });
        }
        urls.push(`  <url><loc>${locale === 'ja' ? japanese : english}</loc>${alternates}</url>`);
      }
    }
    this.emitFile({
      type: 'asset',
      fileName: 'sitemap.xml',
      source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`,
    });
  },
};

export default defineConfig(() => {
  const appRoot = fileURLToPath(new URL('.', import.meta.url));
  const appSrc = `${appRoot}src`;
  const base = process.env.VITE_ASSET_BASE_PATH || '/';
  // The homepage showcase renders the installed SDK release's own wallet
  // surfaces, which the package does not export.
  const walletUi = `${dirname(createRequire(import.meta.url).resolve('@seams/wallet/package.json'))}/dist/esm`;
  return {
    base,
    plugins: [react(), walletLanguagePages],
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
          showcaseAccount: `${appRoot}showcase/account/index.html`,
          showcaseAuthentication: `${appRoot}showcase/authentication/index.html`,
          showcaseTransaction: `${appRoot}showcase/transaction/index.html`,
          showcaseCheckout: `${appRoot}showcase/checkout/index.html`,
          showcaseCheckoutWallet: `${appRoot}showcase/checkout/wallet/index.html`,
          showcaseMotion: `${appRoot}showcase/motion/index.html`,
          showcaseCredentials: `${appRoot}showcase/motion/credentials/index.html`,
          showcasePolicy: `${appRoot}showcase/motion/policy/index.html`,
          showcaseInterlock: `${appRoot}showcase/motion/interlock/index.html`,
          showcaseSelfHostable: `${appRoot}showcase/motion/self-hostable/index.html`,
          showcaseDelegation: `${appRoot}showcase/motion/delegation/index.html`,
        },
      },
    },
  };
});
