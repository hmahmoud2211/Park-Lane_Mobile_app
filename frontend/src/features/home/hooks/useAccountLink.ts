import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmsError } from '../../ems/services/emsApi';
import { emsErrorText } from '../../ems/services/emsHttp';
import * as homeApi from '../services/homeApi';
import type { FlowStep } from '../../../types/home.types';
import { useEms } from '../../ems/hooks/useEms';
import { brand } from '../../../config/brand';

/** Where brand sign-in pages send the browser back to (APP_RETURN_URL on the backend). */
const RETURN_URL = brand.accountsReturnUrl;
/** A background step (the brand finishing on its side) is re-read this often. */
const PROGRESS_POLL_MS = 2_000;
/** Failed re-reads in a row before the wait stops and shows the error with Try again. */
const MAX_POLL_FAILURES = 5;

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
  /** Failed re-reads in a row of a step the brand is still working on. */
  const [pollFailures, setPollFailures] = useState(0);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const run = useCallback(
    async (work: () => Promise<FlowStep | null>) => {
      setBusy(true);
      setError(null);
      setPollFailures(0);
      try {
        const next = await work();
        setStep(next);
        if (next?.type === 'done') {
          // The new account's devices arrive over realtime too; this catches anything missed.
          void refreshHome();
        }
      } catch (caught) {
        setError(emsErrorText(caught));
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
    setPollFailures(0);
    if (current && current.type !== 'done' && current.type !== 'abort') {
      await homeApi.cancelFlow(current.flowId).catch(() => undefined);
    }
  }, []);

  // While the brand works on its side, keep asking until the step moves on. A failed read (a moment
  // without signal) is asked again; only after several in a row does the wait stop, with Try again.
  const pollStalled = step?.type === 'progress' && pollFailures >= MAX_POLL_FAILURES;
  useEffect(() => {
    if (step?.type !== 'progress' || pollFailures >= MAX_POLL_FAILURES) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      homeApi.getFlow(step.flowId).then(
        (next) => {
          if (cancelled) return;
          setPollFailures(0);
          setError(null);
          setStep(next);
          if (next?.type === 'done') {
            void refreshHome();
          }
        },
        (caught: unknown) => {
          if (cancelled) return;
          if (caught instanceof EmsError && caught.code === 'flow_expired') {
            setError(emsErrorText(caught));
            setStep(null);
            return;
          }
          if (pollFailures + 1 >= MAX_POLL_FAILURES) {
            setError(emsErrorText(caught));
          }
          setPollFailures(pollFailures + 1);
        },
      );
    }, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, pollFailures, refreshHome]);

  /** After the wait stopped: ask again. */
  const retryPoll = useCallback(() => {
    setError(null);
    setPollFailures(0);
  }, []);

  return { step, busy, error, pollStalled, retryPoll, start, open, submit, signInWithBrand, cancel };
}
