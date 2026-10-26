import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { emsConfig } from '../constants/emsConfig';
import * as api from '../services/ems/emsApi';
import type { AlexaStatus } from '../types/ems.types';
import { useEms } from './useEms';

export type AlexaBusy = 'connect' | 'disconnect' | 'check' | null;

export interface AlexaNotice {
  tone: 'success' | 'info' | 'error';
  message: string;
}

const FAILURE_REASONS: Record<string, string> = {
  expired: 'The linking request expired. Start again.',
  amazon: 'Amazon did not confirm the link. Try again in a moment.',
};

function messageOf(error: unknown): string {
  return error instanceof api.EmsError ? error.message : 'Something went wrong. Try again.';
}

/**
 * Connects the EMS account to the EMS Voice Control skill without the Alexa
 * app: the backend builds a Login with Amazon URL, the system browser shows
 * Amazon's own sign-in, and the backend enables the skill and links the
 * account. The browser returns to parklane://alexa-link?result=…, but the
 * status shown is always re-read from the backend, which only reports
 * "linked" after Amazon confirmed it.
 */
export function useAlexaIntegration() {
  const { status: authStatus, alexaPushed } = useEms();
  const [status, setStatus] = useState<AlexaStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<AlexaBusy>(null);
  const [notice, setNotice] = useState<AlexaNotice | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const next = await api.getAlexaStatus(force);
      if (mounted.current) setStatus(next);
      return next;
    } catch (error) {
      if (mounted.current) setNotice({ tone: 'error', message: messageOf(error) });
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // On sign-in, and whenever the backend pushes a link change.
  useEffect(() => {
    if (authStatus !== 'signedIn') {
      return;
    }
    let current = true;
    api.getAlexaStatus().then(
      (next) => {
        if (current) setStatus(next);
      },
      (error: unknown) => {
        if (current) setNotice({ tone: 'error', message: messageOf(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [authStatus, alexaPushed]);

  const connect = useCallback(async () => {
    setBusy('connect');
    setNotice(null);
    try {
      const { url } = await api.startAlexaLink();
      if (Platform.OS === 'web') {
        // The web build cannot receive the app-scheme return; check status afterwards.
        await Linking.openURL(url);
        setNotice({ tone: 'info', message: 'Finish signing in with Amazon in the new tab, then tap Check status.' });
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(url, emsConfig.alexaReturnUrl);
      const fresh = await load(true);
      if (result.type === 'success') {
        const outcome = new URL(result.url).searchParams;
        const value = outcome.get('result');
        if (value === 'linked' && fresh?.status === 'linked') {
          setNotice({ tone: 'success', message: 'Alexa is connected. Try “Alexa, open EMS assistant”.' });
        } else if (value === 'cancelled') {
          setNotice({ tone: 'info', message: 'Amazon sign-in was cancelled. Nothing was linked.' });
        } else {
          setNotice({
            tone: 'error',
            message: FAILURE_REASONS[outcome.get('reason') ?? ''] ?? fresh?.lastError ?? 'Alexa could not be connected.',
          });
        }
      } else if (fresh?.status !== 'linked') {
        setNotice({ tone: 'info', message: 'Amazon sign-in was closed before linking finished.' });
      }
    } catch (error) {
      setNotice({ tone: 'error', message: messageOf(error) });
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [load]);

  const disconnect = useCallback(async () => {
    setBusy('disconnect');
    setNotice(null);
    try {
      const result = await api.unlinkAlexa();
      setStatus(result);
      setNotice(
        result.amazonConfirmed
          ? { tone: 'success', message: 'Alexa is disconnected and the skill was disabled for your Amazon account.' }
          : {
              tone: 'info',
              message: result.lastError ?? 'Alexa can no longer reach your devices. You may also disable the skill in your Amazon account.',
            },
      );
    } catch (error) {
      setNotice({ tone: 'error', message: messageOf(error) });
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  const check = useCallback(async () => {
    setBusy('check');
    setNotice(null);
    await load(true);
    if (mounted.current) setBusy(null);
  }, [load]);

  return {
    // A previous account's status is never shown after signing out.
    status: authStatus === 'signedIn' ? status : null,
    loading,
    busy,
    notice,
    connect,
    disconnect,
    check,
    dismissNotice: () => setNotice(null),
  };
}
