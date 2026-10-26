import React from 'react';
import type { DemoThemeId } from './app-themes';

/* The wallet page's preview theme. The hero's theme switch sets it, and the
   component canvas below renders its frames in it. */
type DemoThemeState = {
  theme: DemoThemeId;
  setTheme: (theme: DemoThemeId) => void;
};

const DemoThemeContext = React.createContext<DemoThemeState | null>(null);

export function DemoThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [theme, setTheme] = React.useState<DemoThemeId>('paper');
  const value = React.useMemo(() => ({ theme, setTheme }), [theme]);
  return <DemoThemeContext.Provider value={value}>{children}</DemoThemeContext.Provider>;
}

export function useDemoTheme(): DemoThemeState {
  const state = React.useContext(DemoThemeContext);
  if (state === null) throw new Error('useDemoTheme requires a DemoThemeProvider.');
  return state;
}
