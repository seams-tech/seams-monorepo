import React from 'react';
import { useSiteRouter } from '@/app/router/useSiteRouter';
import { InkDrawing } from '@/components/h2/ink/InkScene';
import { suiteIconScene, type SuiteIcon } from '@/components/h2/ink/suiteIconScenes';

/* The home hero's row of Satyr apps, each a painted ink tile that links to its
   part of the Satyr page. The row shows the whole suite at a glance. */

const list: readonly { name: string; icon: SuiteIcon; to: string }[] = [
  { name: 'Shop', icon: 'shop', to: '/ecommerce#suite' },
  { name: 'Menu', icon: 'menu', to: '/ecommerce#suite' },
  { name: 'Inbox', icon: 'inbox', to: '/ecommerce#suite' },
  { name: 'Kitchen', icon: 'kitchen', to: '/ecommerce#kitchen' },
  { name: 'Stock', icon: 'stock', to: '/ecommerce#suite' },
  { name: 'Payments', icon: 'payments', to: '/ecommerce#suite' },
  { name: 'Devices', icon: 'devices', to: '/ecommerce#kitchen' },
  { name: 'Brain', icon: 'brain', to: '/ecommerce#workflows' },
];

/* one scene for each app, made once, so a render never repaints the tiles */
const apps = list.map((app) => ({ ...app, scene: suiteIconScene(app.icon) }));

export function SuiteTiles(): React.JSX.Element {
  const { linkProps } = useSiteRouter();
  return (
    <nav className="h2-suite" aria-labelledby="h2-suite-label">
      <p id="h2-suite-label" className="h2-suite__label">
        One suite, run by agents
      </p>
      <ul className="h2-suite__list">
        {apps.map((app) => {
          const props = linkProps(app.to);
          return (
            <li key={app.icon}>
              <a className="h2-suite__app" href={props.href} onClick={props.onClick}>
                <InkDrawing scene={app.scene} className="h2-suite__tile" drawn />
                <span>{app.name}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
