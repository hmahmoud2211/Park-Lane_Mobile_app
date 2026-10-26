import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmsError } from '../services/ems/emsApi';
import * as homeApi from '../services/home/homeApi';
import type { FlowStep } from '../types/home.types';
import { useEms } from './useEms';

/** Where brand sign-in pages send the browser back to (APP_RETURN_URL on the backend). */
const RETURN_URL = 'parklane://accounts';
/** A background step (the brand finishing on its side) is re-read this often. */
const PROGRESS_POLL_MS = 2_000;

function messageOf(error: unknown): string {
  return error instanceof EmsError ? error.message : 'Something went wrong. Try again.';
}

/**
 * One brand-linking flow: start, answer each step, sign in on the brand's
 * page when it asks, and finish. The backend runs it as a Home Assistant
 * config flow on the resident's hub; this only follows its steps.
 */
export function useAccountLink() {
  const { refreshHome } = useEms();
  const [step, setStep] = useState<FlowStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const run = useCallback(
    async (work: () => Promise<FlowStep | null>) => {
      setBusy(true);
      setError(null);
      try {
        const next = await work();
        setStep(next);
        if (next?.type === 'done') {
          // The new account's devices arrive over realtime too; this catches anything missed.
          void refreshHome();
        }
      } catch (caught) {
        setError(messageOf(caught));
        if (caught instanceof EmsError && caught.code === 'flow_expired') {
          setStep(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [refreshHome],
  );

  const start = useCallback((integration: string) => run(() => homeApi.startFlow(integration)), [run]);

  /** Continues a flow the backend already has, e.g. a brand asking to sign in again. */
  const open = useCallback((flowId: string) => run(() => homeApi.getFlow(flowId)), [run]);

  const submit = useCallback(
    (data: Record<string, unknown>) => {
      const current = stepRef.current;
      return current ? run(() => homeApi.stepFlow(current.flowId, data)) : Promise.resolve();
    },
    [run],
  );

  /** Opens the brand's sign-in page; when the browser comes back, reads where the flow got to. */
  const signInWithBrand = useCallback(async () => {
    const current = stepRef.current;
    if (!current?.url) {
      return;
    }
    await WebBrowser.openAuthSessionAsync(current.url, RETURN_URL);
    await run(() => homeApi.getFlow(current.flowId));
  }, [run]);

  const cancel = useCallback(async () => {
    const current = stepRef.current;
    setStep(null);
    setError(null);
    if (current && current.type !== 'done' && current.type !== 'abort') {
      await homeApi.cancelFlow(current.flowId).catch(() => undefined);
    }
  }, []);

  // While the brand works on its side, keep asking until the step moves on.
  useEffect(() => {
    if (step?.type !== 'progress') {
      return;
    }
    const timer = setTimeout(() => void run(() => homeApi.getFlow(step.flowId)), PROGRESS_POLL_MS);
    return () => clearTimeout(timer);
  }, [step, run]);

  return { step, busy, error, start, open, submit, signInWithBrand, cancel };
}
