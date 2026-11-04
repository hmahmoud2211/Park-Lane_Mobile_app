import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BrandBadge } from '../../components/gateway/BrandBadge';
import { CredentialFields, missingFields } from '../../components/gateway/CredentialFields';
import { CandidateChips } from '../../components/gateway/RequirementChips';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/parking/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { gatewayConfig } from '../../constants/gatewayConfig';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useBrands } from '../../hooks/useBrands';
import { useGateway } from '../../hooks/useGateway';
import { useGatewayPairing } from '../../hooks/useGatewayPairing';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import * as api from '../../services/gateway/gatewayApi';
import { isPrivateIPv4 } from '../../services/gateway/gatewayDiscovery';
import { errorMessage } from '../../services/gateway/gatewayHttp';
import type { Candidate, DiscoveryJob, FieldSpec } from '../../types/gateway.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { discoveryCopy as copy } from './DeviceDiscoveryScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, PROGRESS_HEIGHT, SMALL_BUTTON_HEIGHT, createStyles } from './DeviceDiscoveryScreen.styles';

const SCAN_TIMEOUT_S = 15;

const byNewest = (a: Candidate, b: Candidate) => b.last_seen - a.last_seen;

/**
 * Add Device, Screen 3: devices the gateway finds on the home network (or at
 * an address the user types), with what each needs to pair. Choosing one
 * pairs it: any key or password the device needs, an "Allow" on a TV, then
 * the gateway reads its state; only then does it count as added.
 */
export function DeviceDiscoveryScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'DeviceDiscovery'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'DeviceDiscovery'>['route']>();
  const mode = params.mode ?? 'scan';
  const { target, subscribe, refresh } = useGateway();
  const { brands } = useBrands();
  const brand = brands?.find((entry) => entry.id === params.brandId);
  const [job, setJob] = useState<DiscoveryJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, Candidate>>({});
  const [selectedId, setSelectedId] = useState<string | null>(params.candidateId ?? null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [host, setHost] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const pairing = useGatewayPairing();
  const jobId = useRef<string | null>(null);

  const add = useCallback((list: Candidate[]) => {
    setCandidates((current) => {
      const next = { ...current };
      for (const candidate of list) {
        if (!params.adapterId || candidate.adapter_id === params.adapterId || params.brandId === 'other') {
          next[candidate.id] = candidate;
        }
      }
      return next;
    });
  }, [params.adapterId, params.brandId]);

  const startScan = useCallback((): Promise<void> => {
    if (!target) return Promise.resolve();
    return api
      .startDiscovery(target, {
        brand_id: params.brandId,
        adapter_ids: params.adapterId ? [params.adapterId] : undefined,
        timeout: SCAN_TIMEOUT_S,
      })
      .then(
        (next) => {
          jobId.current = next.id;
          setJobError(null);
          setJob(next);
        },
        (error: unknown) => setJobError(errorMessage(error, 'The scan could not start.')),
      );
  }, [target, params.brandId, params.adapterId]);

  // Start scanning on arrival; show devices already known for the brand straight away.
  const started = useRef(false);
  useEffect(() => {
    if (!target || started.current) return;
    started.current = true;
    api.listCandidates(target, { brand_id: params.brandId, adapter_id: params.adapterId }).then(add, () => undefined);
    if (mode === 'scan') {
      void startScan();
    }
  }, [target, mode, params.brandId, params.adapterId, add, startScan]);

  // Live progress and finds.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'discovery.progress' && event.data.job.id === jobId.current) {
          setJob(event.data.job);
        } else if (event.type === 'discovery.candidate') {
          add([event.data.candidate]);
        }
      }),
    [subscribe, add],
  );

  // Polling while the scan runs, in case the event channel is down.
  const scanning = job?.status === 'running';
  useEffect(() => {
    if (!scanning || !target || !jobId.current) return;
    const id = jobId.current;
    const timer = setInterval(() => {
      api.getDiscovery(target, id).then((next) => setJob(next), () => undefined);
      api.listCandidates(target, { job_id: id }).then(add, () => undefined);
    }, gatewayConfig.pollMs);
    return () => clearInterval(timer);
  }, [scanning, target, add]);

  // One last read once the scan ends.
  useEffect(() => {
    if (job && job.status !== 'running' && target) {
      api.listCandidates(target, { job_id: job.id }).then(add, () => undefined);
    }
  }, [job, target, add]);

  // Leaving the screen stops a running scan.
  useEffect(
    () => () => {
      if (target && jobId.current) {
        void api.cancelDiscovery(target, jobId.current).catch(() => undefined);
      }
    },
    [target],
  );

  // Paired: on to naming and testing it.
  useEffect(() => {
    if (pairing.pairing?.status === 'paired' && pairing.pairing.device_id) {
      void refresh();
      navigation.replace('DeviceSetup', { deviceId: pairing.pairing.device_id });
    }
  }, [pairing.pairing, navigation, refresh]);

  const probe = async () => {
    const address = host.trim();
    if (!isPrivateIPv4(address)) {
      setProbeError(copy.invalidAddress);
      return;
    }
    if (!target) return;
    setProbing(true);
    setProbeError(null);
    try {
      const candidate = await api.probeHost(target, address, params.adapterId);
      add([candidate]);
      setSelectedId(candidate.id);
    } catch (error) {
      setProbeError(errorMessage(error, copy.notFound));
    } finally {
      setProbing(false);
    }
  };

  const toggleScan = () => {
    if (job?.status === 'running' && target && jobId.current) {
      void api.cancelDiscovery(target, jobId.current).then(setJob, () => undefined);
    } else {
      void startScan();
    }
  };

  const list = Object.values(candidates).sort(byNewest);
  const selected = selectedId ? candidates[selectedId] : undefined;
  const fields: FieldSpec[] = pairing.pairing?.status === 'needs_input' && pairing.pairing.fields.length ? pairing.pairing.fields : (selected?.pairing.fields ?? []);

  const pair = () => {
    if (!selected) return;
    const missing = missingFields(fields, values);
    setFieldErrors(missing);
    if (Object.keys(missing).length > 0) return;
    const credentials = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== '').map(([key, value]) => [key, value.trim()]));
    void pairing.start({ candidate_id: selected.id, credentials });
  };

  const choose = (candidate: Candidate) => {
    if (candidate.paired_device_id) {
      navigation.navigate('DeviceSetup', { deviceId: candidate.paired_device_id });
      return;
    }
    pairing.reset();
    setValues({});
    setFieldErrors({});
    setSelectedId(candidate.id);
  };

  const renderCandidate = (candidate: Candidate) => {
    const detail = [candidate.model, candidate.ip, candidate.protocol].filter(Boolean).join(' · ');
    const isSelected = candidate.id === selectedId;
    return (
      <Pressable
        key={candidate.id}
        onPress={() => choose(candidate)}
        disabled={candidate.control === 'detection_only'}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: candidate.control === 'detection_only' }}
        accessibilityLabel={`${candidate.name ?? candidate.brand}${detail ? `, ${detail}` : ''}`}
        style={({ pressed }) => [pressed && styles.pressed, candidate.control === 'detection_only' && styles.dim]}
      >
        <GlassSurface
          radius={theme.borderRadius.sm}
          blurred={false}
          glow={isSelected}
          strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
          fillOpacity={theme.glass.subtleFillOpacity}
          style={styles.candidate}
        >
          <View style={styles.candidateRow}>
            <BrandBadge logo={brand?.logo ?? candidate.brand} name={brand?.name ?? candidate.brand} />
            <View style={styles.text}>
              <AppText variant="statValue" numberOfLines={2}>
                {candidate.name ?? candidate.model ?? 'Unnamed device'}
              </AppText>
              <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={2}>
                {detail || candidate.unique_id}
              </AppText>
              {candidate.sources.length ? (
                <AppText variant="tileCaption" color={theme.colors.textSupport}>
                  {`Found by ${candidate.sources.join(', ')}`}
                </AppText>
              ) : null}
            </View>
          </View>
          <CandidateChips candidate={candidate} />
          {candidate.control === 'detection_only' ? (
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {copy.detectionOnly}
            </AppText>
          ) : null}
        </GlassSurface>
      </Pressable>
    );
  };

  const renderPairing = () => {
    if (!selected || selected.control === 'detection_only') return null;
    const status = pairing.pairing?.status;
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.pairTitle} iconSet="ionicons" iconName="link-outline" subtitle={selected.name ?? selected.model ?? undefined} divider />
        {selected.pairing.instructions ? (
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {selected.pairing.instructions}
          </AppText>
        ) : null}

        {status === 'awaiting_approval' ? (
          <Notice tone="info" title={copy.approvalTitle}>
            {pairing.pairing?.message ?? copy.approvalBody}
          </Notice>
        ) : null}
        {status === 'running' || pairing.starting ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.textPrimary} />
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {copy.pairing}
            </AppText>
          </View>
        ) : null}
        {status === 'needs_input' ? (
          <Notice tone="warning" title={copy.needsInputTitle}>
            {pairing.pairing?.message}
          </Notice>
        ) : null}
        {status === 'failed' || pairing.error ? (
          <Notice tone="error" title={copy.failedTitle}>
            {[pairing.pairing?.message ?? pairing.error?.message, pairing.error?.recovery].filter(Boolean).join(' ')}
          </Notice>
        ) : null}

        {!pairing.running && status !== 'paired' ? (
          <>
            {fields.length > 0 ? (
              <CredentialFields
                fields={fields}
                values={values}
                errors={fieldErrors}
                onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
              />
            ) : null}
            <View style={styles.row}>
              <AppButton
                title={status === 'failed' ? copy.pairAgain : copy.pair}
                variant="gradient"
                height={BUTTON_HEIGHT}
                loading={pairing.starting}
                onPress={pair}
                style={styles.action}
              />
              <AppButton
                title={copy.otherDevice}
                variant="secondary"
                height={BUTTON_HEIGHT}
                onPress={() => {
                  pairing.reset();
                  setSelectedId(null);
                }}
                style={styles.action}
              />
            </View>
          </>
        ) : null}
      </NeonPanel>
    );
  };

  const renderScan = () => {
    const progress = job ? (job.status === 'running' ? job.progress : 1) : 0;
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={scanning || !job ? copy.scanTitle : copy.scanIdle} iconSet="ionicons" iconName="radio-outline" divider />
        {jobError ? <Notice tone="error">{jobError}</Notice> : null}
        <ProgressBar progress={progress} height={PROGRESS_HEIGHT} accessibilityLabel={copy.progressLabel} />
        <AppText variant="tileCaption" color={theme.colors.textSupport} accessibilityLiveRegion="polite">
          {job ? (job.status === 'running' ? (copy.phases[job.phase] ?? job.phase) : `${list.length} found`) : copy.phases.starting}
        </AppText>
        {job?.errors.length ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {`${copy.noMatchesErrors} ${job.errors.join(' ')}`}
          </AppText>
        ) : null}
        <AppButton
          title={scanning ? copy.cancel : copy.scanAgain}
          variant="secondary"
          height={SMALL_BUTTON_HEIGHT}
          onPress={toggleScan}
        />
      </NeonPanel>
    );
  };

  const renderManual = () => (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.manualTitle} iconSet="ionicons" iconName="locate-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.manualIntro}
      </AppText>
      <AppInput
        variant="field"
        label={copy.manualLabel}
        value={host}
        onChangeText={setHost}
        keyboardType="decimal-pad"
        autoCapitalize="none"
        autoCorrect={false}
        error={probeError ?? undefined}
        height={FIELD_HEIGHT}
      />
      <AppButton title={copy.check} variant="gradient" height={BUTTON_HEIGHT} loading={probing} onPress={() => void probe()} />
    </NeonPanel>
  );

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <PageHeader title={mode === 'manual' ? copy.manualTitle : copy.title} subtitle={brand?.name} style={styles.header} />
          {!target ? (
            <Notice tone="warning">{copy.offline}</Notice>
          ) : (
            <>
              {mode === 'manual' ? renderManual() : renderScan()}
              {renderPairing()}
              <NeonPanel style={styles.panel}>
                <PanelHeading title={copy.foundTitle} iconSet="material" iconName="devices" divider />
                {list.length === 0 ? (
                  <AppText variant="bodySmall" color={theme.colors.textSupport}>
                    {scanning || mode === 'manual' ? copy.noneYet : job ? copy.noneFound : copy.noneYet}
                  </AppText>
                ) : (
                  list.map(renderCandidate)
                )}
              </NeonPanel>
            </>
          )}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
