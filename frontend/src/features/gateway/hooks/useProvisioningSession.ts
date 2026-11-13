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
  const { target, subscribe, reconnect } = useGateway();
  const [session, setSession] = useState<ProvisioningSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  /**
   * The gateway's last working address. While the phone is on a device's hotspot the gateway can
   * go offline here (no address): steps are still queued for it, and sent there once it answers.
   * It is an address that already proved to be this gateway.
   */
  const lastTarget = useRef(target);
  useEffect(() => {
    if (target) lastTarget.current = target;
  }, [target]);

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
  /** The flush in progress: one at a time, since a report can take longer than the poll interval. */
  const flushing = useRef<Promise<boolean> | null>(null);

  /** Sends whatever was queued while the phone was away, in order; true once all are through. */
  const flush = useCallback((): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    const id = sessionId.current;
    const via = target ?? lastTarget.current;
    if (!via || !id) return Promise.resolve(false);
    const run: Promise<boolean> = (async () => {
      while (queue.current.length > 0) {
        if (sessionId.current !== id) return false;
        const [item] = queue.current;
        try {
          const next = await api.reportProvisioning(via, id, item.event, item.data);
          if (sessionId.current === id) setSession(next);
        } catch (failure) {
          if (failure instanceof GatewayError && (failure.code === 'network' || failure.code === 'timeout')) {
            return false;
          }
          setError(describe(failure, 'The gateway did not accept that step.'));
        }
        // Only the step just sent leaves the queue: steps added meanwhile wait their turn.
        const index = queue.current.indexOf(item);
        if (index >= 0) queue.current.splice(index, 1);
      }
      return true;
    })().finally(() => {
      if (flushing.current === run) flushing.current = null;
    });
    flushing.current = run;
    return run;
  }, [target]);

  const report = useCallback(
    async (event: ProvisioningEventName, data: Record<string, unknown> = {}, options: { queueIfUnreachable?: boolean } = {}) => {
      const id = sessionId.current;
      const via = target ?? lastTarget.current;
      if (!via || !id) return null;
      if (queue.current.length > 0) {
        // Earlier steps are still waiting to be sent: this one goes after them, never ahead.
        queue.current.push({ event, data });
        void flush();
        return null;
      }
      try {
        const next = await api.reportProvisioning(via, id, event, data);
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
    [target, flush],
  );

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
          // Events leave out secrets, which only this phone's own requests return; keep the ones it has.
          setSession((current) => ({ ...event.data.session, setup: { ...current?.setup, ...event.data.session.setup } }));
        }
      }),
    [subscribe],
  );

  const [watching, setWatching] = useState(false);
  const active = watching && session !== null && !TERMINAL.has(session.state);
  useEffect(() => {
    const via = target ?? lastTarget.current;
    if (!active || !via || !sessionId.current) return;
    const id = sessionId.current;
    const timer = setInterval(() => {
      void flush().then((done) => {
        if (!done) return;
        api.getProvisioning(via, id).then(
          (next) => {
            if (sessionId.current === id) setSession(next);
            // It answers again (the phone is home) while the app still has it offline: reconnect the app too.
            if (!target) void reconnect();
          },
          () => undefined,
        );
      });
    }, gatewayConfig.pollMs);
    return () => clearInterval(timer);
  }, [active, target, flush, reconnect]);

  const reset = useCallback(() => {
    sessionId.current = null;
    queue.current = [];
    flushing.current = null;
    setSession(null);
    setError(null);
    setWatching(false);
  }, []);

  return { session, error, setError, open, report, flush, run, cancel, watch: () => setWatching(true), reset };
}
