import { createContext, useCallback, useMemo, useState, type PropsWithChildren } from 'react';

interface AppContextValue {
  /**
   * Set once the user leaves the onboarding screen. In-memory only; wiring
   * this to storage or a backend is a later concern.
   */
  hasCompletedOnboarding: boolean;
  completeOnboarding: () => void;
}

export const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: PropsWithChildren) {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

  const completeOnboarding = useCallback(() => {
    setHasCompletedOnboarding(true);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({ hasCompletedOnboarding, completeOnboarding }),
    [hasCompletedOnboarding, completeOnboarding],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
