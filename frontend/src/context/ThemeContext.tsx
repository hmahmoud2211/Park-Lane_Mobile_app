import { createContext, useMemo, type PropsWithChildren } from 'react';

import { parklaneTheme } from '../theme';
import type { AppTheme, ThemeName } from '../types/theme.types';

interface ThemeContextValue {
  theme: AppTheme;
  themeName: ThemeName;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const themes: Record<ThemeName, AppTheme> = {
  parklane: parklaneTheme,
};

interface ThemeProviderProps extends PropsWithChildren {
  /** Defaults to the only theme currently defined. */
  themeName?: ThemeName;
}

export function ThemeProvider({ children, themeName = 'parklane' }: ThemeProviderProps) {
  const value = useMemo<ThemeContextValue>(
    () => ({ theme: themes[themeName], themeName }),
    [themeName],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
