import { useCallback, useEffect, useRef, useState } from 'react';

import { gatewayConfig } from '../constants/gatewayConfig';
import * as api from '../services/gateway/gatewayApi';
import { GatewayError } from '../services/gateway/gatewayHttp';
import type { Pairing } from '../types/gateway.types';
import { useGateway } from './useGateway';

const TERMINAL = new Set<Pairing['status']>(['paired', 'failed', 'needs_input']);

/**
 * One pairing on the gateway (POST /pairings), followed until it ends: from
 * the event channel when it is live, and by polling otherwise. `awaiting_approval`
 * means the user must accept on the device; `needs_input` brings the fields
 * still missing; only `paired` carries the new device's id.
 */
export function useGatewayPairing() {
  const { target, subscribe } = useGateway();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<{ message: string; recovery: string | null } | null>(null);
  const [starting, setStarting] = useState(false);
  const pairingId = useRef<string | null>(null);

  const start = useCallback(
    async (request: { candidate_id: string; credentials?: Record<string, string>; name?: string; room_id?: string | null }) => {
      if (!target) {
        setError({ message: 'Your gateway is not reachable right now.', recovery: null });
        return null;
      }
      setStarting(true);
      setError(null);
      try {
        const next = await api.startPairing(target, request);
        pairingId.current = next.id;
        setPairing(next);
        return next;
      } catch (failure) {
        setError(
          failure instanceof GatewayError
            ? { message: failure.message, recovery: failure.recovery }
            : { message: 'Pairing could not start.', recovery: null },
        );
        return null;
      } finally {
        setStarting(false);
      }
    },
    [target],
  );

  // Live updates.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'pairing.updated' && event.data.pairing.id === pairingId.current) {
          setPairing(event.data.pairing);
        }
      }),
    [subscribe],
  );

  // Polling, while the pairing is still running.
  const running = pairing !== null && !TERMINAL.has(pairing.status);
  useEffect(() => {
    if (!running || !target || !pairingId.current) {
      return;
    }
    const id = pairingId.current;
    const timer = setInterval(() => {
      api.getPairing(target, id).then(
        (next) => {
          if (pairingId.current === id) setPairing(next);
        },
        () => undefined,
      );
    }, gatewayConfig.pollMs);
    return () => clearInterval(timer);
  }, [running, target]);

  const reset = useCallback(() => {
    pairingId.current = null;
    setPairing(null);
    setError(null);
  }, []);

  return { pairing, error, starting, running, start, reset };
}
