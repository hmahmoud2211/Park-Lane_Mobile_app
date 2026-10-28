import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BidiText } from '../../components/health/BidiText';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ErrorNotice, LoadingPanel } from '../../components/health/LoadState';
import { SummaryPlayer } from '../../components/health/SummaryPlayer';
import { CheckRow, ChipGroup } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import {
  useHealthDocuments,
  useHealthRecord,
  useHealthState,
  useHealthSummary,
  type HealthResource,
} from '../../hooks/useHealthData';
import type {
  HealthLang,
  Summary,
  SummaryFailed,
  SummaryGenerating,
} from '../../services/health/health.types';
import { isHealthError, type HealthError } from '../../services/health/healthService';
import { summaryJobKey } from '../../services/health/healthStore';
import { SPECIALTIES, formatClock, formatDateTime, type Specialty } from '../../services/health/i18n';
import { awaitingReview, summaryIsStale } from '../../services/health/selectors';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { LANGUAGE_NAMES, TEXT_SCALES, summaryCopy } from './HealthSummaryScreen.data';
import { createStyles } from './HealthSummaryScreen.styles';

/** The form, or one summary (for a language and specialty) in whatever state it is in. */
type SummaryView =
  | { kind: 'setup'; lang: HealthLang | null }
  | { kind: 'job'; lang: HealthLang; specialty: string | null };

type Navigation = RootStackScreenProps<'HealthSummary'>['navigation'];

const settled = <T,>(resource: HealthResource<T>) => resource.data !== undefined || (resource.error !== null && !resource.loading);

/**
 * The spoken summary for the doctor. Summaries are made on the server in
 * the background and can take several minutes, so the app asks once and
 * then follows the job: the resident can leave and is told when it's ready.
 * A banner opens this screen straight on its summary; otherwise a summary
 * still being made is shown first, then the form.
 */
export function HealthSummaryScreen() {
  const { params } = useRoute<RootStackScreenProps<'HealthSummary'>['route']>();
  // A banner can open this screen for another summary while it is showing: start afresh for it.
  return (
    <SummaryOpening
      key={`${params.profileId}|${params.lang ?? ''}|${params.specialty ?? ''}`}
      profileId={params.profileId}
      lang={params.lang}
      specialty={params.specialty}
    />
  );
}

function SummaryOpening({ profileId, lang, specialty }: { profileId: string; lang?: HealthLang; specialty?: string | null }) {
  const { lang: uiLang } = useHealth();
  const newestAr = useHealthSummary(profileId, 'ar');
  const newestEn = useHealthSummary(profileId, 'en');

  if (lang) return <SummaryBody profileId={profileId} initial={{ kind: 'job', lang, specialty: specialty ?? null }} />;
  if (!settled(newestAr) || !settled(newestEn)) {
    return (
      <HealthFrame title={summaryCopy[uiLang].title}>
        <LoadingPanel />
      </HealthFrame>
    );
  }
  // One started earlier and still being made comes first.
  const running = [newestAr.data, newestEn.data].find((s): s is SummaryGenerating => s?.status === 'generating');
  return (
    <SummaryBody
      profileId={profileId}
      initial={running ? { kind: 'job', lang: running.lang, specialty: running.specialty } : { kind: 'setup', lang: null }}
    />
  );
}

function SummaryBody({ profileId, initial }: { profileId: string; initial: SummaryView }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Navigation>();
  const { lang, t, generateSummary } = useHealth();
  const copy = summaryCopy[lang];

  const [view, setView] = useState<SummaryView>(initial);
  const [setupLang, setSetupLang] = useState<HealthLang | null>(initial.lang);
  /** Null until the resident picks; until then a ready, current general summary is preselected. */
  const [picked, setPicked] = useState<{ value: Specialty | null } | null>(null);
  const [consent, setConsent] = useState(false);
  const [skipPending, setSkipPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HealthError | null>(null);
  const [scale, setScale] = useState(0);

  const record = useHealthRecord(profileId);
  const documents = useHealthDocuments(profileId);
  const newestAr = useHealthSummary(profileId, 'ar');
  const newestEn = useHealthSummary(profileId, 'en');
  const job = useHealthSummary(profileId, view.kind === 'job' ? view.lang : null, view.kind === 'job' ? view.specialty : undefined);
  const general = useHealthSummary(profileId, view.kind === 'setup' ? setupLang : null, 'general');

  const recordUpdatedAt = record.data?.record_updated_at;
  const name = record.data?.patient.name ?? '';
  const pending = documents.data ? awaitingReview(documents.data) : [];
  // A newer general summary the server is preparing after a record change.
  const updating = [newestAr.data, newestEn.data].find((s): s is SummaryGenerating => s?.status === 'generating');

  const toSetup = (preset: HealthLang | null) => {
    setSetupLang(preset);
    setView({ kind: 'setup', lang: preset });
  };

  const generate = async (target: HealthLang, specialty: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const state = await generateSummary(profileId, { lang: target, specialty, consent: true });
      setView({ kind: 'job', lang: target, specialty: state.specialty });
    } catch (caught) {
      if (isHealthError(caught)) setError(caught);
    } finally {
      setBusy(false);
    }
  };

  /** Asking again needs this session's consent; without it, the form opens with the language chosen. */
  const again = (target: HealthLang, specialty: string | null) => {
    if (consent) void generate(target, specialty);
    else toSetup(target);
  };

  const errorNotice = error ? (
    <ErrorNotice
      error={error}
      onRetry={() => (view.kind === 'job' ? again(view.lang, view.specialty) : setupLang && void generate(setupLang, null))}
    />
  ) : null;

  /* ------------------------------------------------------------- Job */

  if (view.kind === 'job') {
    const state = job.data;
    const frame = (children: ReactNode) => (
      <HealthFrame title={copy.title} subtitle={name ? `${name} · ${LANGUAGE_NAMES[view.lang]}` : undefined}>
        {children}
        {errorNotice}
      </HealthFrame>
    );
    if (state === undefined) {
      return frame(job.error && !job.loading ? <ErrorNotice error={job.error} onRetry={job.reload} /> : <LoadingPanel />);
    }
    if (state === null) {
      return frame(
        <Notice
          tone="info"
          title={copy.noneTitle(LANGUAGE_NAMES[view.lang])}
          actions={
            consent ? (
              <ParkingButton compact tone="primary" icon="mic-outline" label={copy.generate} loading={busy} onPress={() => void generate(view.lang, view.specialty)} />
            ) : (
              <ParkingButton compact label={copy.setUp} onPress={() => toSetup(view.lang)} />
            )
          }
        >
          {copy.noneBody}
        </Notice>,
      );
    }
    if (state.status === 'generating') {
      return (
        <SummaryProgress
          profileId={profileId}
          job={state}
          name={name}
          onLeave={() => navigation.goBack()}
          onAnother={() => toSetup(null)}
        />
      );
    }
    if (state.status === 'failed') {
      return (
        <SummaryFailedView
          profileId={profileId}
          failure={state}
          busy={busy}
          onRetry={() => again(state.lang, state.specialty)}
          onAnother={() => toSetup(null)}
          frame={frame}
        />
      );
    }
    return (
      <SummaryResult
        profileId={profileId}
        summary={state}
        name={name}
        stale={summaryIsStale(state, recordUpdatedAt)}
        updating={updating}
        busy={busy}
        scale={scale}
        onScale={setScale}
        onRegenerate={() => again(state.lang, state.specialty)}
        onSwitch={() => setView({ kind: 'job', lang: state.lang === 'ar' ? 'en' : 'ar', specialty: state.specialty })}
        onShowUpdate={(update) => setView({ kind: 'job', lang: update.lang, specialty: update.specialty })}
        onAnother={() => toSetup(null)}
        errorNotice={errorNotice}
      />
    );
  }

  /* ----------------------------------------------------------- Setup */

  const latest = [newestAr.data, newestEn.data]
    .filter((s): s is Summary => s?.status === 'ready')
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
  const generalState = general.data;
  const generalReady = generalState?.status === 'ready' && !summaryIsStale(generalState, recordUpdatedAt);
  const specialty: Specialty | null = picked ? picked.value : generalReady ? 'general' : null;
  const canGenerate = setupLang !== null && consent && (pending.length === 0 || skipPending);
  const detailFor = (value: Specialty) => {
    if (value !== 'general') return copy.takesMinutes;
    if (generalReady) return copy.readyNow;
    if (generalState?.status === 'generating') return copy.beingPrepared;
    return copy.takesMinutes;
  };
  return (
    <HealthFrame
      title={copy.title}
      subtitle={name ? copy.subtitle(name) : undefined}
      bottomBar={false}
      sideNav
      footer={
        <ParkingButton
          tone="primary"
          icon="mic-outline"
          label={copy.generate}
          loading={busy}
          disabled={!canGenerate}
          onPress={() => setupLang && void generate(setupLang, specialty)}
        />
      }
    >
      {updating ? (
        <Notice
          tone="info"
          title={copy.updatingTitle}
          actions={
            <ParkingButton
              compact
              icon="hourglass-outline"
              label={copy.showProgress}
              onPress={() => setView({ kind: 'job', lang: updating.lang, specialty: updating.specialty })}
            />
          }
        >
          {`${copy.phase[updating.phase]} ${copy.updatingBody}`}
        </Notice>
      ) : null}

      {latest ? (
        <Panel
          icon="play-circle-outline"
          title={copy.lastSummary(formatDateTime(latest.generated_at, lang))}
          subtitle={copy.lastSummaryLang(LANGUAGE_NAMES[latest.lang])}
        >
          <ParkingButton
            icon="play"
            label={copy.play}
            onPress={() => setView({ kind: 'job', lang: latest.lang, specialty: latest.specialty })}
          />
          {summaryIsStale(latest, recordUpdatedAt) && !updating ? (
            <Notice
              tone="warning"
              title={copy.staleTitle}
              actions={<ParkingButton compact icon="refresh" label={copy.generateNew} onPress={() => setSetupLang(latest.lang)} />}
            >
              {copy.staleBody}
            </Notice>
          ) : null}
        </Panel>
      ) : null}

      <Panel title={copy.step1} subtitle={copy.step1Hint}>
        <View style={styles.languages} accessibilityRole="radiogroup">
          {(['ar', 'en'] as const).map((value) => {
            const selected = setupLang === value;
            return (
              <Pressable
                key={value}
                onPress={() => setSetupLang(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={LANGUAGE_NAMES[value]}
                style={({ pressed }) => [styles.languageTile, pressed && styles.pressed]}
              >
                <GlassSurface
                  radius={theme.borderRadius.md}
                  glow={selected}
                  stroke="gradient"
                  strokeColors={
                    selected
                      ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]
                      : [theme.colors.dividerSubtle, theme.colors.dividerSubtle]
                  }
                  blurred={false}
                  fillOpacity={selected ? undefined : theme.glass.subtleFillOpacity}
                  style={[styles.languageSurface, !selected && styles.languageIdle]}
                >
                  {selected ? <Ionicons name="checkmark-circle" size={18} color={theme.colors.accent} /> : null}
                  <AppText variant="figure">{LANGUAGE_NAMES[value]}</AppText>
                </GlassSurface>
              </Pressable>
            );
          })}
        </View>
      </Panel>

      <Panel title={copy.step2} subtitle={copy.step2Hint}>
        {/* Every specialty can be chosen; the hints only say how long each will take. */}
        <ChipGroup
          options={SPECIALTIES.map((value) => ({ value, label: t.specialty[value], detail: setupLang ? detailFor(value) : undefined }))}
          value={specialty}
          onChange={(value) => setPicked({ value: specialty === value ? null : value })}
        />
      </Panel>

      <Panel title={copy.step3}>
        <CheckRow label={copy.consent} checked={consent} onChange={setConsent} />
      </Panel>

      {pending.length > 0 && !skipPending ? (
        <Notice
          tone="warning"
          title={copy.pendingTitle(pending.length)}
          actions={
            <>
              <ParkingButton
                compact
                tone="primary"
                icon="checkmark-done-outline"
                label={copy.reviewNow}
                onPress={() => navigation.navigate('HealthReview', { docId: pending[0].id })}
              />
              <ParkingButton compact label={copy.continueAnyway} onPress={() => setSkipPending(true)} />
            </>
          }
        />
      ) : null}

      {errorNotice}
    </HealthFrame>
  );
}

/* ------------------------------------------------------------ Progress */

interface SummaryProgressProps {
  profileId: string;
  job: SummaryGenerating;
  name: string;
  onLeave: () => void;
  onAnother: () => void;
}

/**
 * A summary being made: its phase and how long it has run. The resident is
 * now waiting for it, so it is followed to the end with a banner when done,
 * even if they leave this screen.
 */
function SummaryProgress({ profileId, job, name, onLeave, onAnother }: SummaryProgressProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { lang, watchSummary, recheckSummary } = useHealth();
  const { slowJobs } = useHealthState();
  const copy = summaryCopy[lang];
  const key = summaryJobKey(profileId, job.lang, job.specialty);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    watchSummary(profileId, job);
  }, [profileId, job, watchSummary]);

  const elapsed = Math.max(0, (now - Date.parse(job.started_at)) / 1000);

  return (
    <HealthFrame
      title={copy.title}
      subtitle={name ? `${name} · ${LANGUAGE_NAMES[job.lang]}` : undefined}
      bottomBar={false}
      sideNav
      footer={
        <View style={styles.footer}>
          <ParkingButton tone="primary" icon="arrow-back" label={copy.leave} onPress={onLeave} />
          <ParkingButton label={copy.another} onPress={onAnother} />
        </View>
      }
    >
      <Panel>
        <View style={styles.generating} accessibilityLiveRegion="polite">
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <AppText variant="subheading" align="center">
            {copy.phase[job.phase]}
          </AppText>
          <AppText variant="caption" color={theme.colors.textSecondary} align="center">
            {copy.progressBody}
          </AppText>
          <AppText variant="label" color={theme.colors.textSupport}>
            {copy.elapsed(formatClock(elapsed, lang))}
          </AppText>
        </View>
      </Panel>
      {slowJobs.includes(key) ? (
        <Notice
          tone="warning"
          title={copy.slowTitle}
          actions={<ParkingButton compact icon="refresh" label={copy.checkAgain} onPress={() => recheckSummary(key)} />}
        >
          {copy.slowBody}
        </Notice>
      ) : null}
    </HealthFrame>
  );
}

/* -------------------------------------------------------------- Failed */

interface SummaryFailedViewProps {
  profileId: string;
  failure: SummaryFailed;
  busy: boolean;
  onRetry: () => void;
  onAnother: () => void;
  frame: (children: ReactNode) => ReactElement;
}

function SummaryFailedView({ profileId, failure, busy, onRetry, onAnother, frame }: SummaryFailedViewProps) {
  const { lang, t, store } = useHealth();
  const copy = summaryCopy[lang];
  const key = summaryJobKey(profileId, failure.lang, failure.specialty);
  // Seen here, so no banner about it afterwards.
  useEffect(() => store.dismissNoticesFor(key), [store, key]);
  return frame(
    <Notice
      tone="error"
      title={copy.failedTitle}
      actions={
        <>
          <ParkingButton compact tone="primary" icon="refresh" label={t.actions.retry} loading={busy} onPress={onRetry} />
          <ParkingButton compact label={copy.another} onPress={onAnother} />
        </>
      }
    >
      {failure.error}
    </Notice>,
  );
}

/* -------------------------------------------------------------- Result */

interface SummaryResultProps {
  profileId: string;
  summary: Summary;
  name: string;
  stale: boolean;
  /** A newer summary the server is making, shown instead of offering to regenerate. */
  updating: SummaryGenerating | undefined;
  busy: boolean;
  scale: number;
  onScale: (next: number) => void;
  onRegenerate: () => void;
  onSwitch: () => void;
  onShowUpdate: (update: SummaryGenerating) => void;
  onAnother: () => void;
  errorNotice: ReactNode;
}

function SummaryResult({
  profileId,
  summary,
  name,
  stale,
  updating,
  busy,
  scale,
  onScale,
  onRegenerate,
  onSwitch,
  onShowUpdate,
  onAnother,
  errorNotice,
}: SummaryResultProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { lang, store } = useHealth();
  const copy = summaryCopy[lang];
  const key = summaryJobKey(profileId, summary.lang, summary.specialty);
  // Seen here, so no banner about it afterwards.
  useEffect(() => store.dismissNoticesFor(key), [store, key]);

  const other: HealthLang = summary.lang === 'ar' ? 'en' : 'ar';
  const base = theme.typography.body;
  const size = TEXT_SCALES[scale];
  const paragraphs = summary.transcript.split(/\n\s*\n/).filter((p) => p.trim());

  return (
    <HealthFrame
      title={copy.resultTitle}
      subtitle={`${name} · ${LANGUAGE_NAMES[summary.lang]}`}
      aside={
        <Panel icon="reader-outline" title={copy.transcript}>
          <View style={styles.sizeRow}>
            <AppText variant="label" color={theme.colors.textSupport} style={styles.grow}>
              {copy.textSize}
            </AppText>
            <Pressable
              onPress={() => onScale(Math.max(0, scale - 1))}
              disabled={scale === 0}
              accessibilityRole="button"
              accessibilityLabel={copy.smaller}
              style={[styles.sizeButton, scale === 0 && styles.disabled]}
            >
              <AppText variant="bodyStrong">A−</AppText>
            </Pressable>
            <Pressable
              onPress={() => onScale(Math.min(TEXT_SCALES.length - 1, scale + 1))}
              disabled={scale === TEXT_SCALES.length - 1}
              accessibilityRole="button"
              accessibilityLabel={copy.larger}
              style={[styles.sizeButton, scale === TEXT_SCALES.length - 1 && styles.disabled]}
            >
              <AppText variant="subheading">A+</AppText>
            </Pressable>
          </View>
          <View style={styles.paragraphs}>
            {paragraphs.map((paragraph, index) => (
              <BidiText key={index} selectable style={{ fontSize: base.fontSize * size, lineHeight: base.lineHeight * size }}>
                {paragraph}
              </BidiText>
            ))}
          </View>
        </Panel>
      }
    >
      <Panel icon="volume-high-outline" title={copy.generatedAt(formatDateTime(summary.generated_at, lang))}>
        {summary.cached ? (
          <AppText variant="label" color={theme.colors.textSupport}>
            {copy.savedCopy}
          </AppText>
        ) : null}
        <SummaryPlayer key={summary.audio_url} audioUrl={summary.audio_url} copy={copy.player} />
      </Panel>
      {stale && updating ? (
        <Notice
          tone="info"
          title={copy.updatingTitle}
          actions={<ParkingButton compact icon="hourglass-outline" label={copy.showProgress} onPress={() => onShowUpdate(updating)} />}
        >
          {`${copy.phase[updating.phase]} ${copy.updatingBody}`}
        </Notice>
      ) : stale ? (
        <Notice
          tone="warning"
          title={copy.staleTitle}
          actions={<ParkingButton compact icon="refresh" label={copy.generateNew} loading={busy} onPress={onRegenerate} />}
        >
          {copy.staleBody}
        </Notice>
      ) : null}
      <Notice tone="info">{copy.incomplete}</Notice>
      {errorNotice}
      <View style={styles.row}>
        <ParkingButton icon="refresh" label={copy.regenerate} loading={busy} style={styles.grow} onPress={onRegenerate} />
        <ParkingButton icon="language-outline" label={copy.switchTo(LANGUAGE_NAMES[other])} style={styles.grow} onPress={onSwitch} />
      </View>
      <ParkingButton label={copy.another} onPress={onAnother} />
    </HealthFrame>
  );
}
