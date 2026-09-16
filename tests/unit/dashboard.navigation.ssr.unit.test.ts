import { expect, test } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const consoleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/wallet-console',
);
const consoleRequire = createRequire(path.join(consoleRoot, 'package.json'));
const React = consoleRequire('react');
const { renderToStaticMarkup } = consoleRequire('react-dom/server');
const { createServer } = consoleRequire('vite');

test('dashboard navigation retains the expanded and collapsed sidebar controls', async () => {
  const vite = await createServer({
    root: consoleRoot,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const navigationModule = await vite.ssrLoadModule(
      '/src/core/dashboard/layout/DashboardNavigation.tsx',
    );
    const DashboardNavigation = navigationModule.DashboardNavigation;
    const noop = () => undefined;
    const icon = () => React.createElement('svg');
    const props = {
      network: 'testnet',
      availableNetworks: ['testnet', 'mainnet'],
      onSelectNetwork: noop,
      accountLabel: 'Ada',
      onSelectContext: noop,
      dropdownOptions: {
        organization: [],
        project: [],
        environment: [],
        accountSettings: [],
      },
      pageTitle: 'Overview',
      groups: [
        {
          key: 'main',
          label: 'Main',
          items: [
            {
              key: 'overview',
              label: 'Overview',
              path: '/dashboard/overview',
              icon,
              component: () => React.createElement('div'),
            },
          ],
        },
      ],
      activeRoute: '/dashboard/overview',
      onToggleSidebar: noop,
      linkProps: (to: string) => ({ href: to, onClick: noop }),
      homeProps: { href: '/', onClick: noop },
    };

    const expanded = renderToStaticMarkup(
      React.createElement(DashboardNavigation, {
        ...props,
        isSidebarExpanded: true,
      }),
    );
    const collapsed = renderToStaticMarkup(
      React.createElement(DashboardNavigation, {
        ...props,
        isSidebarExpanded: false,
      }),
    );

    expect(expanded).toContain('aria-label="Collapse sidebar"');
    expect(expanded).toContain('aria-controls="dashboard-sidebar-navigation"');
    expect(collapsed).toContain('aria-label="Expand sidebar"');
    expect(collapsed).toContain('aria-controls="dashboard-sidebar-navigation"');
  } finally {
    await vite.close();
  }
});
