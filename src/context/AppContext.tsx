import { createContext, useCallback, useMemo, useState, type PropsWithChildren } from 'react';

import { assistantConfig } from '../constants/assistantConfig';

interface AppContextValue {
  /**
   * Set once the user leaves the onboarding screen. In-memory only; wiring
   * this to storage or a backend is a later concern.
   */
  hasCompletedOnboarding: boolean;
  completeOnboarding: () => void;
  /**
   * The resident the assistant answers for, or `null` for a guest. Until the
   * app has real sign-in this is a demo resident (see assistantConfig).
   * TODO(auth): set from the login token once authentication lands.
   */
  residentId: number | null;
  setResidentId: (residentId: number | null) => void;
}

export const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: PropsWithChildren) {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [residentId, setResidentId] = useState<number | null>(assistantConfig.defaultResidentId);

  const completeOnboarding = useCallback(() => {
    setHasCompletedOnboarding(true);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({ hasCompletedOnboarding, completeOnboarding, residentId, setResidentId }),
    [hasCompletedOnboarding, completeOnboarding, residentId],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
