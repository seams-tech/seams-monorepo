import React from 'react';
import { Toaster } from 'sonner';
import './Toaster.css';

export const ToasterThemed: React.FC = () => {
  return (
    <Toaster
      position="bottom-right"
      theme="light"
      closeButton
      toastOptions={{
        duration: 3500,
        style: {
          background: 'var(--site-toast-background, var(--seams-colors-surface))',
          color: 'var(--site-toast-text-primary, var(--seams-colors-textPrimary))',
          border: '1px solid var(--site-toast-border, var(--seams-colors-borderPrimary))',
          borderRadius: '1rem',
          boxShadow: 'var(--site-toast-shadow, var(--seams-shadows-lg))',
        },
        // Keep error toasts (e.g., registration failures) visible
        // until the user explicitly closes them.
        // @ts-ignore
        error: {
          duration: Infinity,
        },
      }}
    />
  );
};

export default ToasterThemed;
