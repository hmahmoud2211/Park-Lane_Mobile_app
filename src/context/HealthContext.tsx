import { createContext, useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { healthConfig } from '../constants/healthConfig';
import { reportSessionExpired } from '../services/ems/emsApi';
import { createHealthService } from '../services/health/createHealthService';
import type {
  ConfirmInput,
  HealthDocument,
  HealthLang,
  HealthProfile,
  ItemData,
  ProfileInput,
  RecordSection,
  SummaryRequest,
  SummaryState,
  UploadInput,
  UploadResult,
} from '../services/health/health.types';
import type { HealthService } from '../services/health/healthService';
import { HealthStore, healthKeys, parseSummaryJobKey, summaryJobKey } from '../services/health/healthStore';
import { deviceLang, healthStrings, type HealthStrings } from '../services/health/i18n';
import { clearOriginals } from '../services/health/localFiles';
import { StatusPoller } from '../services/health/statusPoller';

export interface HealthContextValue {
  service: HealthService;
  store: HealthStore;
  /** The feature's language: the phone's at first, switchable from any Health Passport header. */
  lang: HealthLang;
  t: HealthStrings;
  toggleLang: () => void;
  /** The profile Health Passport is showing; null until profiles load. */
  activeProfileId: string | null;
  setActiveProfileId: (id: string) => void;
  /** Bumped when the backend refuses the session, so the navigator can send the resident to sign in. */
  sessionEndedAt: number | null;

  fetchers: {
    consent: () => ReturnType<HealthService['getConsent']>;
    profiles: () => Promise<HealthProfile[]>;
    record: (profileId: string) => ReturnType<HealthService['getRecord']>;
    documents: (profileId: string) => Promise<HealthDocument[]>;
    document: (docId: string) => Promise<HealthDocument>;
    summary: (profileId: string, lang: HealthLang, specialty?: string | null) => Promise<SummaryState | null>;
  };

  setConsent: (given: boolean) => Promise<void>;
  saveProfile: (id: string | null, input: ProfileInput) => Promise<HealthProfile>;
  deleteProfile: (id: string) => Promise<void>;
  saveItem: <S extends RecordSection>(profileId: string, section: S, itemId: string | null, data: ItemData<S>) => Promise<void>;
  deleteItem: (profileId: string, section: RecordSection, itemId: string) => Promise<void>;
  upload: (
    profileId: string,
    input: UploadInput,
    options?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ) => Promise<UploadResult>;
  confirm: (doc: HealthDocument, input: ConfirmInput) => Promise<HealthDocument>;
  deleteDocument: (doc: Pick<HealthDocument, 'id' | 'profile_id'>, deleteItems: boolean) => Promise<void>;
  /** Asks for a summary; one that isn't ready yet is followed until it is, with a banner when done. */
  generateSummary: (profileId: string, request: Omit<SummaryRequest, 'async'>) => Promise<SummaryState>;
  /** The resident is waiting for this running summary: banner when it's done, even off-screen. */
  watchSummary: (profileId: string, job: SummaryState) => void;
  /** Checks a slow job again from the start of its schedule: a document id, or a summary's job key. */
  recheckDocument: (docId: string) => void;
  recheckSummary: (jobKey: string) => void;
  /** Forgets everything the feature holds: on sign-out and when the session ends. */
  clearSession: () => void;
}

export const HealthContext = createContext<HealthContextValue | undefined>(undefined);

/**
 * What the service reads on every request, outside React's render cycle:
 * the language to ask in, and what to do when the backend refuses the session.
 */
class ServiceBridge {
  private end: () => void = () => undefined;

  constructor(public lang: HealthLang) {}

  setLang(lang: HealthLang) {
    this.lang = lang;
  }

  onSessionEnd(end: () => void) {
    this.end = end;
  }

  endSession() {
    this.end();
  }
}

/**
 * Owns Health Passport's service, its in-memory cache and the pollers that
 * follow the server's background jobs: documents being read and summaries
 * being made. Mutations go through here so each one marks exactly the
 * cached data it changed as out of date.
 */
export function HealthProvider({ children }: PropsWithChildren) {
  const [lang, setLang] = useState<HealthLang>(deviceLang);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [sessionEndedAt, setSessionEndedAt] = useState<number | null>(null);
  const [bridge] = useState(() => new ServiceBridge(lang));

  const [store] = useState(() => new HealthStore());
  const [service] = useState(() =>
    createHealthService({ getLang: () => bridge.lang, onUnauthorized: () => bridge.endSession() }),
  );

  const [poller] = useState(
    () =>
      new StatusPoller<HealthDocument>({
        fetch: (docId) => service.getDocument(docId),
        isPending: (doc) => doc.status === 'processing',
        schedule: healthConfig.poll,
        onUpdate: (doc) => {
          store.set(healthKeys.document(doc.id), doc);
          store.update<HealthDocument[]>(healthKeys.documents(doc.profile_id), (docs) =>
            docs.map((entry) => (entry.id === doc.id ? doc : entry)),
          );
        },
        onSettled: (doc) => {
          store.pushNotice({
            kind: doc.status === 'failed' ? 'failed' : 'ready',
            key: doc.id,
            docId: doc.id,
            profileId: doc.profile_id,
            at: Date.now(),
          });
          store.invalidate(healthKeys.documents(doc.profile_id), healthKeys.record(doc.profile_id));
        },
        onGiveUp: (docId) => store.setSlow(docId, true),
      }),
  );

  const [summaryPoller] = useState(
    () =>
      new StatusPoller<SummaryState | null>({
        fetch: (key) => {
          const job = parseSummaryJobKey(key);
          return service.getSummary(job.profileId, job.lang, job.specialty);
        },
        isPending: (state) => state?.status === 'generating',
        schedule: healthConfig.summaryPoll,
        onUpdate: (state, key) => {
          const job = parseSummaryJobKey(key);
          store.set(healthKeys.summary(job.profileId, job.lang, job.specialty), state);
          store.invalidate(healthKeys.summary(job.profileId, job.lang));
        },
        onSettled: (state, key) => {
          const job = parseSummaryJobKey(key);
          if (!state || !store.takeWatched(key)) return;
          store.pushNotice({
            kind: state.status === 'failed' ? 'summary_failed' : 'summary_ready',
            key,
            profileId: job.profileId,
            lang: job.lang,
            specialty: job.specialty,
            at: Date.now(),
          });
        },
        onGiveUp: (key) => store.setSlow(key, true),
      }),
  );

  /** Follows any summary seen still running, from when it started. */
  const follow = useCallback(
    (profileId: string, state: SummaryState | null) => {
      if (state?.status === 'generating') {
        summaryPoller.track(summaryJobKey(profileId, state.lang, state.specialty), Date.parse(state.started_at));
      }
      return state;
    },
    [summaryPoller],
  );

  const clearSession = useCallback(() => {
    poller.clear();
    summaryPoller.clear();
    store.clear();
    clearOriginals();
    setActiveProfileId(null);
  }, [poller, summaryPoller, store]);

  useEffect(() => {
    bridge.onSessionEnd(() => {
      clearSession();
      reportSessionExpired();
      setSessionEndedAt(Date.now());
    });
  }, [bridge, clearSession]);

  // Status checks run only in the foreground; returning checks at once.
  useEffect(() => {
    const foreground = AppState.currentState !== 'background';
    poller.setForeground(foreground);
    summaryPoller.setForeground(foreground);
    const subscription = AppState.addEventListener('change', (state) => {
      poller.setForeground(state === 'active');
      summaryPoller.setForeground(state === 'active');
    });
    return () => {
      subscription.remove();
      poller.clear();
      summaryPoller.clear();
    };
  }, [poller, summaryPoller]);

  const fetchers = useMemo<HealthContextValue['fetchers']>(
    () => ({
      consent: () => service.getConsent(),
      profiles: () => service.listProfiles(),
      record: (profileId) => service.getRecord(profileId),
      documents: async (profileId) => {
        const docs = await service.listDocuments(profileId);
        for (const doc of docs) {
          if (doc.status === 'processing') poller.track(doc.id, Date.parse(doc.uploaded_at));
        }
        return docs;
      },
      document: async (docId) => {
        const doc = await service.getDocument(docId);
        if (doc.status === 'processing') poller.track(doc.id, Date.parse(doc.uploaded_at));
        return doc;
      },
      summary: async (profileId, summaryLang, specialty) =>
        follow(profileId, await service.getSummary(profileId, summaryLang, specialty)),
    }),
    [service, poller, follow],
  );

  const toggleLang = useCallback(() => {
    const next = bridge.lang === 'en' ? 'ar' : 'en';
    bridge.setLang(next);
    setLang(next);
    // Gaps and failure reasons arrive in the request's language.
    store.invalidate('record:', 'documents:', 'document:', 'summary:');
  }, [bridge, store]);

  const setConsent = useCallback(
    async (given: boolean) => {
      const consent = await service.setConsent(given);
      if (!given) {
        poller.clear();
        summaryPoller.clear();
        store.clear();
      }
      store.set(healthKeys.consent, consent);
    },
    [service, store, poller, summaryPoller],
  );

  // Any change to a record starts a fresh general summary on the server.
  const saveProfile = useCallback(
    async (id: string | null, input: ProfileInput) => {
      const profile = id ? await service.updateProfile(id, input) : await service.addProfile(input);
      store.invalidate(healthKeys.profiles, healthKeys.record(profile.id), healthKeys.summaries(profile.id));
      return profile;
    },
    [service, store],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      await service.deleteProfile(id);
      store.invalidate(healthKeys.profiles, healthKeys.record(id), healthKeys.documents(id), healthKeys.summaries(id));
      setActiveProfileId((current) => (current === id ? null : current));
    },
    [service, store],
  );

  const saveItem = useCallback(
    async <S extends RecordSection>(profileId: string, section: S, itemId: string | null, data: ItemData<S>) => {
      if (itemId) {
        await service.updateItem(profileId, section, itemId, data);
      } else {
        await service.createItem(profileId, section, data);
      }
      store.invalidate(healthKeys.record(profileId), healthKeys.summaries(profileId));
    },
    [service, store],
  );

  const deleteItem = useCallback(
    async (profileId: string, section: RecordSection, itemId: string) => {
      await service.deleteItem(profileId, section, itemId);
      store.invalidate(healthKeys.record(profileId), healthKeys.summaries(profileId));
    },
    [service, store],
  );

  const upload = useCallback<HealthContextValue['upload']>(
    async (profileId, input, options) => {
      const result = await service.uploadDocument(profileId, input, options);
      poller.track(result.id);
      store.invalidate(healthKeys.documents(profileId));
      return result;
    },
    [service, store, poller],
  );

  const confirm = useCallback(
    async (doc: HealthDocument, input: ConfirmInput) => {
      const updated = await service.confirmDocument(doc.id, input);
      store.set(healthKeys.document(doc.id), updated);
      store.invalidate(healthKeys.documents(doc.profile_id), healthKeys.record(doc.profile_id), healthKeys.summaries(doc.profile_id));
      if (updated.status !== 'needs_review') store.dismissNoticesFor(doc.id);
      return updated;
    },
    [service, store],
  );

  const deleteDocument = useCallback(
    async (doc: Pick<HealthDocument, 'id' | 'profile_id'>, deleteItems: boolean) => {
      await service.deleteDocument(doc.id, deleteItems);
      poller.untrack(doc.id);
      store.dismissNoticesFor(doc.id);
      store.setSlow(doc.id, false);
      // The document's own entry stays until sign-out: the screen showing it is closing, and nothing links to it now.
      store.invalidate(healthKeys.documents(doc.profile_id), healthKeys.record(doc.profile_id), healthKeys.summaries(doc.profile_id));
    },
    [service, store, poller],
  );

  const generateSummary = useCallback(
    async (profileId: string, request: Omit<SummaryRequest, 'async'>) => {
      const state = await service.generateSummary(profileId, { ...request, async: true });
      store.set(healthKeys.summary(profileId, state.lang, state.specialty), state);
      store.invalidate(healthKeys.summary(profileId, state.lang));
      if (state.status === 'generating') {
        const key = summaryJobKey(profileId, state.lang, state.specialty);
        store.watch(key);
        store.dismissNoticesFor(key);
        follow(profileId, state);
      }
      return state;
    },
    [service, store, follow],
  );

  const watchSummary = useCallback(
    (profileId: string, job: SummaryState) => {
      if (job.status !== 'generating') return;
      store.watch(summaryJobKey(profileId, job.lang, job.specialty));
      follow(profileId, job);
    },
    [store, follow],
  );

  const recheckDocument = useCallback(
    (docId: string) => {
      store.setSlow(docId, false);
      poller.restart(docId);
    },
    [store, poller],
  );

  const recheckSummary = useCallback(
    (jobKey: string) => {
      store.setSlow(jobKey, false);
      summaryPoller.restart(jobKey);
    },
    [store, summaryPoller],
  );

  const value = useMemo<HealthContextValue>(
    () => ({
      service,
      store,
      lang,
      t: healthStrings[lang],
      toggleLang,
      activeProfileId,
      setActiveProfileId,
      sessionEndedAt,
      fetchers,
      setConsent,
      saveProfile,
      deleteProfile,
      saveItem,
      deleteItem,
      upload,
      confirm,
      deleteDocument,
      generateSummary,
      watchSummary,
      recheckDocument,
      recheckSummary,
      clearSession,
    }),
    [
      service,
      store,
      lang,
      toggleLang,
      activeProfileId,
      sessionEndedAt,
      fetchers,
      setConsent,
      saveProfile,
      deleteProfile,
      saveItem,
      deleteItem,
      upload,
      confirm,
      deleteDocument,
      generateSummary,
      watchSummary,
      recheckDocument,
      recheckSummary,
      clearSession,
    ],
  );

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}
