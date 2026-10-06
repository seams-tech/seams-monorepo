import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@/styles/h2.css';
import { MotionStudies } from './page';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing motion studies root');
createRoot(container).render(
  <React.StrictMode>
    <MotionStudies />
  </React.StrictMode>,
);
