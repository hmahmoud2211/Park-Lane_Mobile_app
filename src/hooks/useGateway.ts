import { useContext } from 'react';

import { GatewayContext } from '../context/GatewayContext';

export function useGateway() {
  const context = useContext(GatewayContext);

  if (!context) {
    throw new Error('useGateway must be used inside a GatewayProvider');
  }

  return context;
}
