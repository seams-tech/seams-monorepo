import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProductTour } from '@/components/h2/ProductTour';
import '@/app.css';
import '@/styles/h2.css';

/* Review harness for the front-page product tour: `?step=N&hold&still` stops it on one
   feature with its card shown and no motion. */
const params = new URLSearchParams(window.location.search);

createRoot(document.getElementById('root')!).render(
  <main style={{ padding: '48px 16px 96px' }}>
    <ProductTour
      initialStep={Number(params.get('step') ?? 0)}
      hold={params.has('hold')}
      still={params.has('still')}
    />
  </main>,
);
