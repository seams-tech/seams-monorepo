import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { parseSitePage, pagePath, type TranslatedPage, type Locale } from './src/i18n/locale';
import { languageHtml, escapeHtml } from './src/i18n/metadata';

const translatedPages: readonly TranslatedPage[] = ['pricing', 'company'];
const locales: readonly Locale[] = ['en', 'ja'];

function normalizePageRoute(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  const url = new URL(request.url || '/', 'http://localhost');
  const page = parseSitePage(url.pathname);
  if (page.kind === 'translated' && !url.pathname.endsWith('/')) {
    response.writeHead(308, { Location: `${pagePath(page.page, page.locale)}${url.search}` });
    response.end();
    return;
  }
  next();
}

function siteLanguagePages(origin: string): Plugin {
  return {
    name: 'site-language-pages',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(normalizePageRoute);
    },
    configurePreviewServer(server) {
      server.middlewares.use(normalizePageRoute);
    },
    transformIndexHtml(html, context) {
      const page = parseSitePage(new URL(context.originalUrl || context.path, origin).pathname);
      return page.kind === 'translated' ? languageHtml(html, page.page, page.locale, origin) : html;
    },
    generateBundle(_options, bundle) {
      const entry = bundle['index.html'];
      if (!entry || entry.type !== 'asset' || typeof entry.source !== 'string') {
        throw new Error('Company site build requires index.html');
      }
      const urls = [`<url><loc>${escapeHtml(new URL('/', origin).href)}</loc></url>`];
      for (const page of translatedPages) {
        const english = escapeHtml(new URL(pagePath(page, 'en'), origin).href);
        const japanese = escapeHtml(new URL(pagePath(page, 'ja'), origin).href);
        const alternates = `<xhtml:link rel="alternate" hreflang="en" href="${english}"/><xhtml:link rel="alternate" hreflang="ja" href="${japanese}"/><xhtml:link rel="alternate" hreflang="x-default" href="${english}"/>`;
        for (const locale of locales) {
          const path = pagePath(page, locale);
          this.emitFile({
            type: 'asset',
            fileName: `${path.slice(1)}index.html`,
            source: languageHtml(entry.source, page, locale, origin),
          });
          urls.push(`<url><loc>${locale === 'ja' ? japanese : english}</loc>${alternates}</url>`);
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`,
      });
    },
  };
}

/**
 * Do NOT use optional chaining or dynamic access such as `import.meta?.env`
 * or `import.meta["env"]`. Those patterns prevent Vite's static analysis
 * and will yield `undefined` at runtime without errors.
 * See: https://vite.dev/guide/env-and-mode
 */

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, workspaceRoot, '');

  const appSrc = fileURLToPath(new URL('./src', import.meta.url));
  const appPublic = fileURLToPath(new URL('./src/public', import.meta.url));
  const workspaceNodeModules = fileURLToPath(new URL('../../node_modules', import.meta.url));
  const cacheDir = env.VITE_CACHE_DIR || undefined;
  const walletDistRoot = String(env.VITE_SEAMS_WALLET_DIST_ROOT || '').trim();
  const walletAliases = walletDistRoot
    ? [
        {
          find: /^@seams\/wallet\/react\/styles$/,
          replacement: `${walletDistRoot}/esm/react/styles/styles.css`,
        },
        {
          find: /^@seams\/wallet\/react\/profile$/,
          replacement: `${walletDistRoot}/esm/react/components/AccountMenuButton/index.js`,
        },
        {
          find: /^@seams\/wallet\/react\/provider$/,
          replacement: `${walletDistRoot}/esm/react/context/SeamsWebProvider.js`,
        },
        {
          find: /^@seams\/wallet\/react$/,
          replacement: `${walletDistRoot}/esm/react/index.js`,
        },
        {
          find: /^@seams\/wallet\/advanced$/,
          replacement: `${walletDistRoot}/esm/advanced.js`,
        },
        { find: /^@seams\/wallet$/, replacement: `${walletDistRoot}/esm/index.js` },
      ]
    : [];

  return {
    envDir: workspaceRoot,
    clearScreen: false,
    logLevel: 'info',
    cacheDir,
    publicDir: appPublic,
    server: {
      port: 4004,
      host: 'localhost',
      strictPort: true,
      // Allow access via reverse-proxied hosts (Caddy) and Bonjour (.local)
      // Needed to avoid Vite's DNS‑rebinding protection blocking mDNS hosts
      allowedHosts: ['localhost', 'pta-m4.local'],
      open: false,
      fs: {
        allow: [
          workspaceRoot,
          // Allow serving files from entire workspace including SDK
        ],
      },
    },
    plugins: [react(), siteLanguagePages(env.VITE_SITE_ORIGIN || 'https://seams.sh/')],
    optimizeDeps: walletDistRoot
      ? {
          noDiscovery: true,
          include: [
            'react',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            'react-dom',
            'react-dom/client',
            '@seams/wallet',
            '@seams/wallet/advanced',
            '@seams/wallet/react',
            '@seams/wallet/react/profile',
            '@seams/wallet/react/provider',
          ],
        }
      : undefined,
    resolve: {
      alias: [
        { find: '@', replacement: appSrc },
        ...walletAliases,
        { find: /^react$/, replacement: `${workspaceNodeModules}/react/index.js` },
        {
          find: /^react\/jsx-runtime$/,
          replacement: `${workspaceNodeModules}/react/jsx-runtime.js`,
        },
        {
          find: /^react\/jsx-dev-runtime$/,
          replacement: `${workspaceNodeModules}/react/jsx-dev-runtime.js`,
        },
        { find: /^react-dom$/, replacement: `${workspaceNodeModules}/react-dom/index.js` },
        {
          find: /^react-dom\/client$/,
          replacement: `${workspaceNodeModules}/react-dom/client.js`,
        },
      ],
      dedupe: ['react', 'react-dom'],
    },
  };
});
