import { useContext } from 'react';

import { HealthContext } from '../context/HealthContext';

/** Health Passport's service, cache, language and actions. */
export function useHealth() {
  const context = useContext(HealthContext);
  if (!context) {
    throw new Error('useHealth must be used inside a HealthProvider');
  }
  return context;
}
