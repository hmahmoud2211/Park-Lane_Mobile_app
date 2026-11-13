import { useNavigation, useRoute } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { GatewayStatusRow } from '../../features/gateway/components/GatewayStatusRow';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { QrScanner } from '../../components/common/QrScanner';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { EmsAccountPanel } from '../../features/ems/components/EmsAccountPanel';
import { useEms } from '../../features/ems/hooks/useEms';
import { useGateway } from '../../features/gateway/hooks/useGateway';
import { useGatewayPhones } from '../../features/gateway/hooks/useGatewayPhones';
import * as api from '../../features/gateway/services/gatewayApi';
import { scanLan, type FoundGateway } from '../../features/gateway/services/gatewayDiscovery';
import { errorMessage } from '../../features/gateway/services/gatewayHttp';
import type { PhoneRow } from '../../features/gateway/services/gatewayPhones';
import { useUnit } from '../../features/unit/hooks/useUnit';
import type { StoredGateway } from '../../features/gateway/services/gatewayStore';
import { isRemoteGatewayUrl, parsePairPayload } from '../../features/gateway/services/pairCode';
import type { RemoteStatus } from '../../types/gateway.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { gatewaySetupCopy as copy } from './GatewaySetupScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, PROGRESS_HEIGHT, SMALL_BUTTON_HEIGHT, createStyles } from './GatewaySetupScreen.styles';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';

type Mode = 'setup' | 'invite';

/**
 * Connecting this phone to a CUBE Gateway. A signed-in resident connects to
 * their apartment's gateway through their EMS account (GatewayContext does it
 * by itself; this screen shows how it went and can try again). The codes are
 * for installers, under Installer setup: a new gateway prints a one-time setup
 * code (and a QR code holding its address and that code) in its logs, whoever
 * can read the logs owns it, and other phones join with an invite code from
 * the owner. Also where the owner sets up access from outside the home
 * (Tailscale or a relay) and invites other phones.
 */
export function GatewaySetupScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'GatewaySetup'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'GatewaySetup'>['route']>();
  const gateway = useGateway();
  const { target, active } = gateway;
  const ems = useEms();
  const resident = ems.status === 'signedIn';
  // Open for whoever arrives with a code to enter.
  const [installerOpen, setInstallerOpen] = useState(Boolean(params?.host || params?.code));

  const [host, setHost] = useState(params?.host ?? '');
  const [code, setCode] = useState(params?.code ?? '');
  const [mode, setMode] = useState<Mode>('setup');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrNeedsAddress, setQrNeedsAddress] = useState(false);

  const [found, setFound] = useState<FoundGateway[]>([]);
  const [scanProgress, setScanProgress] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);

  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const phones = useGatewayPhones(ems.user?.id ?? null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ id: string; message: string } | null>(null);
  // Membership is what opens the apartment's gateway to an account; the people and invites live on Household.
  const unit = useUnit();
  const [remoteDraft, setRemoteDraft] = useState<string | null>(null);
  const [remoteSaved, setRemoteSaved] = useState(false);
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  const [relayUrl, setRelayUrl] = useState('');
  const [relayToken, setRelayToken] = useState('');
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; minutes: number } | null>(null);
  const [scanned, setScanned] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const isOwner = active?.role === 'owner';

  // The owner's view of remote access.
  useEffect(() => {
    if (!target || !isOwner) return;
    let cancelled = false;
    api.getRemote(target).then(
      (next) => {
        if (!cancelled) setRemote(next);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [target, isOwner]);

  useEffect(() => () => scanAbort.current?.abort(), []);

  const scan = useCallback(async () => {
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    setFound([]);
    setScanError(null);
    setScanProgress(0);
    setScanned(true);
    try {
      await scanLan({
        signal: controller.signal,
        onFound: (entry) => setFound((current) => [...current.filter((item) => item.baseUrl !== entry.baseUrl), entry]),
        onProgress: setScanProgress,
      });
    } catch (error) {
      setScanError(errorMessage(error, copy.scanNone));
    } finally {
      if (scanAbort.current === controller) setScanProgress(null);
    }
  }, []);

  const connect = async () => {
    if (!host.trim() || !code.trim()) {
      setConnectError(`${!host.trim() ? copy.host : copy.code}: ${copy.required}`);
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const stored = mode === 'setup' ? await gateway.claim(host, code) : await gateway.join(host, code);
      setCode('');
      setConnectedName(stored.name);
    } catch (error) {
      setConnectError(errorMessage(error, 'Could not connect to the gateway.'));
    } finally {
      setConnecting(false);
    }
  };

  const onQr = (data: string) => {
    const payload = parsePairPayload(data);
    setQrError(payload ? null : copy.qrInvalid);
    setQrNeedsAddress(payload?.baseUrl === null);
    if (!payload) {
      return;
    }
    setQrOpen(false);
    if (payload.baseUrl) {
      setHost(payload.baseUrl);
    }
    if (payload.code) {
      setCode(payload.code);
      setMode('setup');
    }
  };

  const forget = (stored: StoredGateway) => {
    if (confirmForget !== stored.id) {
      setConfirmForget(stored.id);
      return;
    }
    setConfirmForget(null);
    setForgetting(stored.id);
    // An account-issued gateway is told first (a short, best-effort call), so show it working.
    void gateway.forget(stored.id).finally(() => setForgetting(null));
  };

  const removePhone = async (row: PhoneRow) => {
    setRemoving(row.id);
    setRemoveError(null);
    try {
      await phones.remove(row.id);
      setConfirmRemove(null);
    } catch (error) {
      setRemoveError({ id: row.id, message: errorMessage(error, copy.removeFailed) });
    } finally {
      setRemoving(null);
    }
  };

  const saveRemote = async () => {
    if (!active || remoteDraft === null) return;
    const urls = remoteDraft
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    await gateway.setRemoteEndpoints(active.id, urls);
    setRemoteDraft(null);
    setRemoteSaved(true);
  };

  const enableRelay = async () => {
    if (!target || !active || !relayUrl.trim()) return;
    setRelayBusy(true);
    setRelayError(null);
    try {
      const next = await api.enableRelay(target, relayUrl.trim(), relayToken.trim() || undefined);
      setRemote(next);
      setRelayToken('');
      if (next.relay.public_url) {
        await gateway.setRemoteEndpoints(active.id, [...(active.endpoints.remote ?? []), next.relay.public_url]);
      }
    } catch (error) {
      setRelayError(errorMessage(error, 'The gateway could not connect to the relay.'));
    } finally {
      setRelayBusy(false);
    }
  };

  const disableRelay = async () => {
    if (!target) return;
    setRelayBusy(true);
    setRelayError(null);
    try {
      setRemote(await api.disableRelay(target));
    } catch (error) {
      setRelayError(errorMessage(error, 'The relay could not be turned off.'));
    } finally {
      setRelayBusy(false);
    }
  };

  const createInvite = async (role: 'member' | 'owner') => {
    if (!target) return;
    setInviteError(null);
    try {
      const next = await api.createInvite(target, role);
      // expires_at is in seconds since the epoch, like every gateway timestamp.
      setInvite({ code: next.code, minutes: Math.max(0, Math.round((next.expires_at * 1000 - Date.now()) / 60_000)) });
    } catch (error) {
      setInviteError(errorMessage(error, 'The invite could not be created.'));
    }
  };

  const renderStored = (stored: StoredGateway) => {
    const isActive = stored.id === active?.id;
    const address = stored.lastUrl ?? stored.endpoints.lan ?? stored.endpoints.remote?.[0] ?? '';
    return (
      <GlassSurface
        key={stored.id}
        radius={theme.borderRadius.sm}
        blurred={false}
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.item}
      >
        <View style={styles.itemRow}>
          <View style={styles.text}>
            <AppText variant="statValue">{stored.name}</AppText>
            {address ? (
              <AppText variant="tileCaption" color={theme.colors.textSupport} selectable>
                {copy.address(address)}
              </AppText>
            ) : null}
          </View>
          {isActive ? <StatusChip label={copy.active} tone="teal" icon="checkmark-outline" /> : null}
          {stored.source === 'account' ? (
            <StatusChip label={copy.viaAccount} tone="indigo" icon="person-circle-outline" />
          ) : !stored.endpoints.lan ? (
            <StatusChip label={copy.onServer} tone="indigo" icon="cloud-outline" />
          ) : null}
          <StatusChip label={stored.role === 'owner' ? 'Owner' : 'Member'} tone="slate" />
        </View>
        <View style={styles.row}>
          {!isActive ? (
            <AppButton title={copy.use} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => gateway.select(stored.id)} style={styles.action} />
          ) : gateway.status !== 'online' ? (
            <AppButton title={copy.reconnect} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void gateway.reconnect()} style={styles.action} />
          ) : null}
          <AppButton
            title={confirmForget === stored.id ? copy.confirmForget : copy.forget}
            variant="secondary"
            height={SMALL_BUTTON_HEIGHT}
            loading={forgetting === stored.id}
            onPress={() => forget(stored)}
            accessibilityHint="Removes this gateway's key from this phone"
            style={styles.action}
          />
        </View>
      </GlassSurface>
    );
  };

  const renderFound = (entry: FoundGateway) => (
    <Pressable
      key={entry.baseUrl}
      onPress={() => {
        setHost(entry.baseUrl);
        setMode(entry.health.claimed ? 'invite' : 'setup');
      }}
      accessibilityRole="button"
      accessibilityLabel={`${entry.health.name}, ${entry.baseUrl}. ${copy.choose}`}
    >
      <GlassSurface
        radius={theme.borderRadius.sm}
        blurred={false}
        glow={host === entry.baseUrl}
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.item}
      >
        <View style={styles.itemRow}>
          <View style={styles.text}>
            <AppText variant="statValue">{entry.health.name}</AppText>
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {`${entry.baseUrl} · v${entry.health.version}`}
            </AppText>
          </View>
          <StatusChip label={entry.health.claimed ? copy.claimed : copy.unclaimed} tone={entry.health.claimed ? 'slate' : 'teal'} />
        </View>
      </GlassSurface>
    </Pressable>
  );

  const renderRemote = () => {
    if (!active) return null;
    if (!active.endpoints.lan) {
      // Reached only through the relay (on CUBE's server, or through the account); Tailscale and relay settings do not apply.
      return (
        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.remoteTitle} iconSet="ionicons" iconName="globe-outline" divider />
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {active.source === 'account' ? copy.accountRemoteIntro : copy.serverRemoteIntro}
          </AppText>
        </NeonPanel>
      );
    }
    const remoteValue = remoteDraft ?? (active.endpoints.remote ?? []).join(', ');
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.remoteTitle} iconSet="ionicons" iconName="globe-outline" divider />
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.remoteIntro}
        </AppText>
        {remote?.tailscale.detected && remote.tailscale.addresses.length ? (
          <>
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {copy.tailscaleFound}
            </AppText>
            <View style={styles.chips}>
              {remote.tailscale.addresses.map((address) => (
                <FilterChip
                  key={address}
                  label={address}
                  iconSet="ionicons"
                  iconName="shield-checkmark-outline"
                  selected={remoteValue.includes(address)}
                  onPress={() => setRemoteDraft(remoteValue ? `${remoteValue}, ${address}` : address)}
                />
              ))}
            </View>
          </>
        ) : null}
        <AppInput
          variant="field"
          label={copy.remoteLabel}
          value={remoteValue}
          onChangeText={(text) => {
            setRemoteDraft(text);
            setRemoteSaved(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          height={FIELD_HEIGHT}
        />
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {copy.remoteHelp}
        </AppText>
        <AppButton
          title={remoteSaved && remoteDraft === null ? copy.savedRemote : copy.saveRemote}
          variant="secondary"
          height={SMALL_BUTTON_HEIGHT}
          disabled={remoteDraft === null}
          onPress={() => void saveRemote()}
        />

        <View style={styles.divider} />
        <AppText variant="statValue">{copy.relayTitle}</AppText>
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {copy.relayIntro}
        </AppText>
        {!isOwner ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.ownerOnly}
          </AppText>
        ) : remote?.relay.configured ? (
          <>
            <StatusChip
              label={remote.relay.connected ? copy.relayConnected : copy.relayNotConnected}
              tone={remote.relay.connected ? 'teal' : 'amber'}
              icon={remote.relay.connected ? 'cloud-done-outline' : 'cloud-offline-outline'}
            />
            {remote.relay.public_url ? (
              <AppText variant="tileCaption" color={theme.colors.textSupport} selectable>
                {remote.relay.public_url}
              </AppText>
            ) : null}
            {remote.relay.last_error ? <Notice tone="warning">{remote.relay.last_error}</Notice> : null}
            <AppButton title={copy.relayDisable} variant="secondary" height={SMALL_BUTTON_HEIGHT} loading={relayBusy} onPress={() => void disableRelay()} />
          </>
        ) : (
          <>
            <AppInput variant="field" label={copy.relayUrl} value={relayUrl} onChangeText={setRelayUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" height={FIELD_HEIGHT} />
            <AppInput
              variant="field"
              label={copy.relayToken}
              value={relayToken}
              onChangeText={setRelayToken}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              height={FIELD_HEIGHT}
            />
            <AppButton title={copy.relayEnable} variant="secondary" height={SMALL_BUTTON_HEIGHT} loading={relayBusy} disabled={!relayUrl.trim() || !target} onPress={() => void enableRelay()} />
          </>
        )}
        {relayError ? <Notice tone="error">{relayError}</Notice> : null}
      </NeonPanel>
    );
  };

  // On an account gateway family join through the apartment (Members); the gateway's own codes are for installers' phones.
  const renderInvite = () =>
    isOwner && target && active?.source !== 'account' ? (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.inviteTitle} iconSet="ionicons" iconName="person-add-outline" divider />
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.inviteIntro}
        </AppText>
        {invite ? (
          <AppText variant="statValue" selectable accessibilityLiveRegion="polite">
            {copy.inviteCode(invite.code, invite.minutes)}
          </AppText>
        ) : null}
        {inviteError ? <Notice tone="error">{inviteError}</Notice> : null}
        <View style={styles.row}>
          <AppButton title={copy.inviteMember} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void createInvite('member')} style={styles.action} />
          <AppButton title={copy.inviteOwner} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void createInvite('owner')} style={styles.action} />
        </View>
      </NeonPanel>
    ) : null;

  const renderAccount = () => {
    const link = gateway.account;
    const linked = link.state === 'connected' ? gateway.gateways.find((entry) => entry.id === link.gatewayId) : undefined;
    // The context re-issues a refused account token once by itself; a refusal after that stays until asked.
    const refused = linked?.source === 'account' && linked.id === active?.id && gateway.status === 'unauthorized';
    const connectAccount = () => void gateway.connectAccount();
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.accountTitle} iconSet="ionicons" iconName="home-outline" divider />
        {link.state === 'connecting' ? (
          <LoadingState label={copy.accountConnecting} announce />
        ) : refused ? (
          <ErrorNotice title={copy.accountRefusedTitle} retryLabel={copy.accountRetry} onRetry={connectAccount} buttonHeight={SMALL_BUTTON_HEIGHT}>
            {copy.accountRefused}
          </ErrorNotice>
        ) : linked ? (
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {linked.source === 'account' ? copy.accountConnected(linked.name) : copy.accountPaired(linked.name)}
          </AppText>
        ) : link.state === 'no_gateway' && unit.state.status === 'none' ? (
          <Notice tone="info" title={copy.accountNoUnitTitle}>
            {copy.accountNoUnit}
          </Notice>
        ) : link.state === 'no_gateway' ? (
          <Notice
            tone="info"
            title={copy.accountNoGatewayTitle}
            actions={<AppButton title={copy.accountCheckAgain} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={connectAccount} />}
          >
            {copy.accountNoGateway}
          </Notice>
        ) : link.state === 'error' ? (
          <ErrorNotice
            title={copy.accountErrorTitle}
            retryLabel={copy.accountRetry}
            onRetry={connectAccount}
            buttonHeight={SMALL_BUTTON_HEIGHT}
            tone={link.code === 'network' || link.code === 'timeout' ? 'warning' : 'error'}
          >
            {copy.accountError(link.code, link.message)}
          </ErrorNotice>
        ) : (
          <>
            <AppText variant="bodySmall" color={theme.colors.textSupport}>
              {copy.accountIntro}
            </AppText>
            <AppButton title={copy.accountConnect} variant="gradient" height={BUTTON_HEIGHT} onPress={connectAccount} />
          </>
        )}
        {/* Signing out a lost phone lives in Settings → Account & security, with the password. */}
      </NeonPanel>
    );
  };

  // Membership is what opens the apartment's gateway to an account: one row here, and the people,
  // invites and joining with a code on the Household screen.
  const renderHousehold = () => {
    const { state } = unit;
    if (state.status !== 'none' && state.status !== 'ready') return null;
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading
          title={copy.householdTitle}
          subtitle={state.status === 'ready' ? copy.householdSummary(state.unit.unit.name, state.unit.members.length) : undefined}
          iconSet="ionicons"
          iconName="people-outline"
        />
        <AppButton
          title={state.status === 'none' ? copy.householdJoin : copy.householdOpen}
          variant={state.status === 'none' ? 'gradient' : 'secondary'}
          height={state.status === 'none' ? BUTTON_HEIGHT : SMALL_BUTTON_HEIGHT}
          onPress={() => navigation.navigate('Household')}
        />
      </NeonPanel>
    );
  };

  const renderPhone = (row: PhoneRow) => (
    <GlassSurface
      key={row.id}
      radius={theme.borderRadius.sm}
      blurred={false}
      strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={styles.item}
    >
      <View style={styles.itemRow}>
        <View style={styles.text}>
          <AppText variant="statValue">{row.name}</AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.phoneDetail(row)}
          </AppText>
        </View>
        {row.thisPhone ? <StatusChip label={copy.thisPhone} tone="teal" icon="phone-portrait-outline" /> : null}
        <StatusChip
          label={copy.phoneOrigin(row.origin)}
          tone={row.origin === 'installer' ? 'slate' : 'indigo'}
          icon={row.origin === 'installer' ? 'construct-outline' : 'person-circle-outline'}
        />
      </View>
      {row.removable && confirmRemove === row.id ? (
        <Notice
          tone="warning"
          actions={
            <>
              <AppButton title={copy.removeConfirm} variant="secondary" height={SMALL_BUTTON_HEIGHT} loading={removing === row.id} onPress={() => void removePhone(row)} />
              <AppButton title={copy.cancel} variant="secondary" height={SMALL_BUTTON_HEIGHT} disabled={removing === row.id} onPress={() => setConfirmRemove(null)} />
            </>
          }
        >
          {copy.removeWarning(row)}
        </Notice>
      ) : row.removable ? (
        <View style={styles.row}>
          <AppButton
            title={copy.remove}
            variant="secondary"
            height={SMALL_BUTTON_HEIGHT}
            onPress={() => {
              setConfirmRemove(row.id);
              setRemoveError(null);
            }}
            accessibilityHint={copy.removeWarning(row)}
            style={styles.action}
          />
        </View>
      ) : null}
      {removeError?.id === row.id ? <Notice tone="error">{removeError.message}</Notice> : null}
    </GlassSurface>
  );

  const renderPhones = () => {
    const { state } = phones;
    if (state.status === 'hidden') return null;
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.phonesTitle} iconSet="ionicons" iconName="phone-portrait-outline" divider />
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.phonesIntro}
        </AppText>
        {state.status === 'loading' ? <LoadingState label={copy.phonesLoading} /> : null}
        {state.status === 'error' ? (
          <ErrorNotice title={copy.phonesError} retryLabel={copy.accountRetry} onRetry={phones.reload} buttonHeight={SMALL_BUTTON_HEIGHT} tone="warning">
            {state.message}
          </ErrorNotice>
        ) : null}
        {state.status === 'ready' ? state.rows.map(renderPhone) : null}
      </NeonPanel>
    );
  };

  // The phone's own network can't be scanned on the web.
  const findContent =
    Platform.OS !== 'web' ? (
      <>
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.findIntro}
        </AppText>
        {scanProgress !== null ? (
          <>
            <ProgressBar progress={scanProgress} height={PROGRESS_HEIGHT} accessibilityLabel={copy.scanning} />
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {copy.scanning}
            </AppText>
          </>
        ) : null}
        {scanError ? <Notice tone="warning">{scanError}</Notice> : null}
        {found.map(renderFound)}
        {scanProgress === null && found.length === 0 && !scanError && scanned ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.scanNone}
          </AppText>
        ) : null}
        <AppButton title={copy.scan} variant="secondary" height={SMALL_BUTTON_HEIGHT} loading={scanProgress !== null} onPress={() => void scan()} />
      </>
    ) : null;

  const connectContent = (
    <>
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.connectIntro}
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup">
        <FilterChip role="radio" label={copy.modeSetup} iconSet="ionicons" iconName="key-outline" selected={mode === 'setup'} onPress={() => setMode('setup')} />
        <FilterChip role="radio" label={copy.modeInvite} iconSet="ionicons" iconName="mail-outline" selected={mode === 'invite'} onPress={() => setMode('invite')} />
      </View>
      <AppInput
        variant="field"
        label={copy.host}
        value={host}
        onChangeText={setHost}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        height={FIELD_HEIGHT}
      />
      <AppText variant="tileCaption" color={theme.colors.textSupport}>
        {copy.hostHelp}
      </AppText>
      <AppInput
        variant="field"
        label={copy.code}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        height={FIELD_HEIGHT}
      />
      {qrOpen ? <QrScanner onScan={onQr} onClose={() => setQrOpen(false)} /> : null}
      {qrError ? <Notice tone="warning">{qrError}</Notice> : null}
      {qrNeedsAddress && !host.trim() ? <Notice tone="warning">{copy.qrNoAddress}</Notice> : null}
      {connectError ? <Notice tone="error">{connectError}</Notice> : null}
      <View style={styles.row}>
        {Platform.OS !== 'web' ? (
          <AppButton
            title={qrOpen ? copy.closeQr : copy.scanQr}
            variant="secondary"
            height={BUTTON_HEIGHT}
            onPress={() => setQrOpen((open) => !open)}
            style={styles.action}
          />
        ) : null}
        <AppButton title={copy.connect} variant="gradient" height={BUTTON_HEIGHT} loading={connecting} onPress={() => void connect()} style={styles.action} />
      </View>
      {isRemoteGatewayUrl(host) ? (
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {copy.serverSecurity}
        </AppText>
      ) : (
        <>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.localNetwork}
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.security}
          </AppText>
        </>
      )}
    </>
  );

  // A signed-in resident connects through their account, so the codes fold away into one
  // secondary panel; without a session they are the way in and stay as their own panels.
  const renderManual = () =>
    resident ? (
      <>
      <NeonPanel style={styles.panel}>
        <PanelHeading
          title={copy.installerTitle}
          iconSet="ionicons"
          iconName="construct-outline"
          subtitle={installerOpen ? undefined : copy.installerSubtitle}
          actionLabel={installerOpen ? copy.hide : copy.show}
          actionExpanded={installerOpen}
          onActionPress={() => setInstallerOpen((open) => !open)}
          divider={installerOpen}
        />
        {installerOpen ? (
          <>
            <AppText variant="bodySmall" color={theme.colors.textSupport}>
              {copy.installerIntro}
            </AppText>
            {findContent ? (
              <>
                <View style={styles.divider} />
                <AppText variant="statValue">{copy.findTitle}</AppText>
                {findContent}
              </>
            ) : null}
            <View style={styles.divider} />
            <AppText variant="statValue">{copy.connectTitle}</AppText>
            {connectContent}
          </>
        ) : null}
      </NeonPanel>
      {/* The rest is for installers too: it opens with Advanced setup. */}
      {installerOpen ? (
        <>
          {renderRemote()}
          {renderPhones()}
          {renderInvite()}
        </>
      ) : null}
      </>
    ) : (
      <>
        {findContent ? (
          <NeonPanel style={styles.panel}>
            <PanelHeading title={copy.findTitle} iconSet="ionicons" iconName="search-outline" divider />
            {findContent}
          </NeonPanel>
        ) : null}
        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.connectTitle} iconSet="ionicons" iconName="link-outline" divider />
          {connectContent}
        </NeonPanel>
      </>
    );

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />

      {active ? (
        <GatewayStatusRow
          status={gateway.status}
          name={active.name}
          detail={gateway.status === 'online' ? null : gateway.problem}
          manageLabel={copy.addDevice}
          onManage={() => navigation.navigate('AddDevice')}
        />
      ) : null}

      {connectedName ? (
        <Notice
          tone="success"
          actions={<AppButton title={copy.addDevice} variant="gradient" height={BUTTON_HEIGHT} onPress={() => navigation.navigate('AddDevice')} />}
        >
          {copy.connected(connectedName)}
        </Notice>
      ) : null}

      {resident ? renderAccount() : ems.configured && ems.status === 'signedOut' ? <EmsAccountPanel intro={copy.signInHint} /> : null}
      {resident ? renderHousehold() : null}

      {gateway.gateways.length > 0 ? (
        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.pairedTitle} iconSet="ionicons" iconName="hardware-chip-outline" divider />
          {gateway.gateways.map(renderStored)}
        </NeonPanel>
      ) : null}

      {renderManual()}

      {resident ? null : (
        <>
          {renderRemote()}
          {renderPhones()}
          {renderInvite()}
        </>
      )}
    </InnerScreenFrame>
  );
}
