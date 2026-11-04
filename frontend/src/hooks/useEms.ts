import { useContext } from 'react';

import { EmsContext } from '../context/EmsContext';

export function useEms() {
  const context = useContext(EmsContext);

  if (!context) {
    throw new Error('useEms must be used inside an EmsProvider');
  }

  return context;
}
