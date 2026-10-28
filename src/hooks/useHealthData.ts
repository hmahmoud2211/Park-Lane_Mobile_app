import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { HealthLang } from '../services/health/health.types';
import { healthKeys, type HealthState, type Resource } from '../services/health/healthStore';
import { useHealth } from './useHealth';

export interface HealthResource<T> extends Resource<T> {
  /** Fetches again, e.g. from an error state's "Try again". */
  reload: () => void;
}

/**
 * One cached Health Passport resource. Fetches it when the screen first
 * needs it and again whenever a change marks it out of date; a failed
 * fetch waits for `reload` rather than retrying on its own.
 */
export function useHealthResource<T>(key: string | null, fetcher: () => Promise<T>): HealthResource<T> {
  const { store } = useHealth();
  const resource = useSyncExternalStore(
    store.subscribe,
    () => (key ? store.resource<T>(key) : store.resource<T>('')),
  );

  const reload = useCallback(() => {
    if (key) void store.load(key, fetcher);
  }, [key, store, fetcher]);

  const needsFetch = key !== null && !resource.loading && (resource.stale || (resource.data === undefined && !resource.error));
  useEffect(() => {
    if (needsFetch) reload();
  }, [needsFetch, reload]);

  return { ...resource, loading: resource.loading || needsFetch, reload };
}

export function useHealthConsent() {
  const { fetchers } = useHealth();
  return useHealthResource(healthKeys.consent, fetchers.consent);
}

export function useHealthProfiles() {
  const { fetchers } = useHealth();
  return useHealthResource(healthKeys.profiles, fetchers.profiles);
}

export function useHealthRecord(profileId: string | null) {
  const { fetchers } = useHealth();
  const fetcher = useCallback(() => fetchers.record(profileId ?? ''), [fetchers, profileId]);
  return useHealthResource(profileId ? healthKeys.record(profileId) : null, fetcher);
}

export function useHealthDocuments(profileId: string | null) {
  const { fetchers } = useHealth();
  const fetcher = useCallback(() => fetchers.documents(profileId ?? ''), [fetchers, profileId]);
  return useHealthResource(profileId ? healthKeys.documents(profileId) : null, fetcher);
}

export function useHealthDocument(docId: string) {
  const { fetchers } = useHealth();
  const fetcher = useCallback(() => fetchers.document(docId), [fetchers, docId]);
  return useHealthResource(healthKeys.document(docId), fetcher);
}

/**
 * A summary's current state: for one specialty, or without one the newest in
 * that language. Null `lang` waits, e.g. until the doctor has picked one.
 */
export function useHealthSummary(profileId: string | null, lang: HealthLang | null, specialty?: string | null) {
  const { fetchers } = useHealth();
  const fetcher = useCallback(
    () => fetchers.summary(profileId ?? '', lang ?? 'en', specialty),
    [fetchers, profileId, lang, specialty],
  );
  return useHealthResource(profileId && lang ? healthKeys.summary(profileId, lang, specialty) : null, fetcher);
}

/** Notices and slow documents, for banners and badges. */
export function useHealthState(): HealthState {
  const { store } = useHealth();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
