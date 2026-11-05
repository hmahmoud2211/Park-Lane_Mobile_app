import { useCallback, useEffect, useRef, useState } from 'react';

import { gatewayConfig } from '../../../config/gateway';
import * as api from '../services/gatewayApi';
import { GatewayError } from '../services/gatewayHttp';
import type { ProvisioningEventName, ProvisioningSession } from '../../../types/gateway.types';
import { useGateway } from './useGateway';

const TERMINAL = new Set(['connected', 'pairing_failed']);

/**
 * A provisioning session on the gateway: opening it, reporting what the phone
 * did, and following its state (events, plus polling while the phone is back
 * on the home network and the gateway looks for the device). Only the gateway
 * moves a session to `connected`, after it found the device and read its state.
 */
export function useProvisioningSession() {
  const { target, subscribe } = useGateway();
  const [session, setSession] = useState<ProvisioningSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);

  const describe = (failure: unknown, fallback: string) =>
    failure instanceof GatewayError ? [failure.message, failure.recovery].filter(Boolean).join(' ') : fallback;

  const open = useCallback(
    async (pluginId: string, model: string | null) => {
      if (!target) {
        setError('Your gateway is not reachable right now.');
        return null;
      }
      setError(null);
      try {
        const next = await api.startProvisioning(target, pluginId, model);
        sessionId.current = next.id;
        setSession(next);
        return next;
      } catch (failure) {
        setError(describe(failure, 'The setup could not start.'));
        return null;
      }
    },
    [target],
  );

  /**
   * Tells the gateway what the phone did. While the phone is on the device's
   * hotspot the gateway is out of reach, so reports made then are queued and
   * sent once it answers again.
   */
  const queue = useRef<{ event: ProvisioningEventName; data: Record<string, unknown> }[]>([]);
  const report = useCallback(
    async (event: ProvisioningEventName, data: Record<string, unknown> = {}, options: { queueIfUnreachable?: boolean } = {}) => {
      const id = sessionId.current;
      if (!target || !id) return null;
      try {
        const next = await api.reportProvisioning(target, id, event, data);
        setSession(next);
        return next;
      } catch (failure) {
        if (options.queueIfUnreachable && failure instanceof GatewayError && (failure.code === 'network' || failure.code === 'timeout')) {
          queue.current.push({ event, data });
          return null;
        }
        setError(describe(failure, 'The gateway did not accept that step.'));
        return null;
      }
    },
    [target],
  );

  /** Sends whatever was queued while the phone was away; true once all are through. */
  const flush = useCallback(async () => {
    const id = sessionId.current;
    if (!target || !id) return false;
    while (queue.current.length > 0) {
      const [item] = queue.current;
      try {
        setSession(await api.reportProvisioning(target, id, item.event, item.data));
        queue.current.shift();
      } catch (failure) {
        if (failure instanceof GatewayError && (failure.code === 'network' || failure.code === 'timeout')) {
          return false;
        }
        queue.current.shift();
        setError(describe(failure, 'The gateway did not accept that step.'));
      }
    }
    return true;
  }, [target]);

  const run = useCallback(
    async (request: { home_ssid: string; home_password: string; hotspot_ssid: string; hotspot_password?: string | null }) => {
      const id = sessionId.current;
      if (!target || !id) return null;
      setError(null);
      try {
        const next = await api.runProvisioning(target, id, request);
        setSession(next);
        return next;
      } catch (failure) {
        setError(describe(failure, 'The gateway could not start the setup.'));
        return null;
      }
    },
    [target],
  );

  const cancel = useCallback(async () => {
    const id = sessionId.current;
    if (target && id && session && !TERMINAL.has(session.state)) {
      await api.cancelProvisioning(target, id).catch(() => undefined);
    }
  }, [target, session]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'provisioning.updated' && event.data.session.id === sessionId.current) {
          setSession(event.data.session);
        }
      }),
    [subscribe],
  );

  const [watching, setWatching] = useState(false);
  const active = watching && session !== null && !TERMINAL.has(session.state);
  useEffect(() => {
    if (!active || !target || !sessionId.current) return;
    const id = sessionId.current;
    const timer = setInterval(() => {
      void flush().then((done) => {
        if (!done) return;
        api.getProvisioning(target, id).then(
          (next) => {
            if (sessionId.current === id) setSession(next);
          },
          () => undefined,
        );
      });
    }, gatewayConfig.pollMs);
    return () => clearInterval(timer);
  }, [active, target, flush]);

  const reset = useCallback(() => {
    sessionId.current = null;
    queue.current = [];
    setSession(null);
    setError(null);
    setWatching(false);
  }, []);

  return { session, error, setError, open, report, flush, run, cancel, watch: () => setWatching(true), reset };
}
