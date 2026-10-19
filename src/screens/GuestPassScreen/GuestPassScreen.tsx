import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { FactGrid, Field, InfoRow, type Fact } from '../../components/parking/Controls';
import { LanguageToggle } from '../../components/parking/LanguageToggle';
import { Notice, type NoticeTone } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ParkingFrame } from '../../components/parking/ParkingFrame';
import { PassQr } from '../../components/parking/Rows';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import { moveOutDeadline } from '../../services/parking/charging';
import {
  dateIn,
  deviceLang,
  gateDescriptionIn,
  gateNameIn,
  isLang,
  nameIn,
  rangeIn,
  timeIn,
  type Lang,
} from '../../services/parking/i18n';
import { siteInfo } from '../../services/parking/policy';
import { decodePassSnapshot, snapshotView } from '../../services/parking/passLink';
import { findInvitation, gateMapsUrl, notificationsFor, reservationView } from '../../services/parking/selectors';
import { formatDateTime } from '../../services/parking/time';
import { ParkingError } from '../../services/parking/tx';
import type { AppNotification } from '../../services/parking/types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { savePassImage, type QrImageSource } from '../../utils/passImage';
import { openExternal } from '../../utils/share';
import { chargerNameIn, passCopy } from './GuestPassScreen.data';
import { createStyles } from './GuestPassScreen.styles';

/**
 * What a visitor sees from their invitation link. No account: the link's
 * token identifies the booking. It shows only this visit, never the host's
 * contact details or anyone else's parking. English or Arabic: the link can
 * choose, the guest can switch, and otherwise the phone's language decides.
 */
export function GuestPassScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'GuestPass'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'GuestPass'>['route']>();
  const { db, now, service } = useParking();
  const [plate, setPlate] = useState('');
  const [message, setMessage] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSecurity, setShowSecurity] = useState(false);
  const qrSource = useRef<QrImageSource | null>(null);

  const lang: Lang = isLang(params.lang) ? params.lang : deviceLang();
  const t = passCopy[lang];
  const rtl = lang === 'ar';
  const frame = {
    title: t.title,
    bottomBar: false,
    showBack: navigation.canGoBack(),
    rtl,
    headerTrailing: (
      <LanguageToggle
        label={t.switchLabel}
        accessibilityLabel={t.switchA11y}
        onPress={() => {
          setMessage(null);
          navigation.setParams({ lang: rtl ? 'en' : 'ar' });
        }}
      />
    ),
  };

  const found = findInvitation(db, params.invite);
  // Demo only: on the guest's own phone the booking isn't stored, so the pass is rebuilt from the link.
  const snapshot = found ? null : decodePassSnapshot(params.d, db);
  const fromLink = Boolean(snapshot);
  const view = found ? reservationView(db, found.reservation, now) : snapshot ? snapshotView(db, snapshot, now) : null;

  if (!view) {
    return (
      <ParkingFrame {...frame}>
        <Notice tone="warning" title={t.notFoundTitle}>
          {t.notFoundBody}
        </Notice>
      </ParkingFrame>
    );
  }

  const r = view.reservation;
  const statusKey = view.status.key;
  const caption = t.qrCaption[statusKey];
  const showQr = Boolean(caption) && view.credential?.status === 'active';
  const alerts = notificationsFor(db, 'visitor', { reservationId: r.id }).slice(0, 2);
  const projection = view.chargingProjection;
  const moveOutBy = view.charging ? moveOutDeadline(db, view.charging) : null;

  const errorText = (e: unknown) =>
    e instanceof ParkingError ? (lang === 'en' ? e.message : (t.errors[e.code] ?? t.failed)) : t.failed;

  /** Stored notices are written in English; Arabic rewords the ones a visitor gets. */
  const alertText = (n: AppNotification) => {
    if (lang === 'ar' && n.kind === 'charging-complete') {
      return { title: t.chargingCompleteTitle, body: t.chargingCompleteBody(view.space.label, moveOutBy ? timeIn(moveOutBy, lang) : '') };
    }
    if (lang === 'ar' && n.kind === 'charger-fault') {
      return { title: t.chargerFaultTitle, body: t.chargerFaultBody };
    }
    return { title: n.title, body: n.body };
  };

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveQr = async () => {
    const qr = qrSource.current;
    if (!qr) return;
    setBusy('save');
    setMessage(null);
    const outcome = await savePassImage({
      qr,
      fileName: `parking-pass-${r.reference}`,
      lang,
      title: t.imageTitle,
      compound: siteInfo.compoundName,
      guest: r.guest?.name ?? '',
      when: rangeIn(r.scheduledStart, r.scheduledEnd, lang),
      caption: caption ?? '',
      facts: [
        { label: t.yourSpace, value: `${view.space.label} · ${nameIn(view.zone.name, lang)} · ${nameIn(view.zone.level, lang)}` },
        { label: t.entrance, value: gateNameIn(view.gate.id, lang) },
        { label: t.vehicle, value: r.vehiclePlate ?? t.notAdded },
        { label: t.reference, value: r.reference },
      ],
      footer: `${siteInfo.compoundName} · ${t.city}`,
      theme,
    });
    setBusy(null);
    setMessage({ tone: outcome === 'failed' ? 'error' : outcome === 'dismissed' ? 'info' : 'success', text: t.saved[outcome] });
  };

  const inside = r.status === 'checked-in';
  const facts: Fact[] = [
    { icon: 'location-outline', label: t.yourSpace, value: view.space.label, detail: `${nameIn(view.zone.name, lang)} · ${nameIn(view.zone.level, lang)}` },
    { icon: 'enter-outline', label: t.entrance, value: gateNameIn(view.gate.id, lang, true), detail: gateDescriptionIn(view.gate.id, lang) },
  ];
  // While the plate is missing, the "Add your vehicle" card above already says so.
  // A pass opened from a link can't save anything, so a missing plate goes back to the host.
  const needsPlate = r.status === 'confirmed' && !r.vehiclePlate && !fromLink;
  facts.push({ icon: 'business-outline', label: t.building, value: view.building ? nameIn(view.building.name, lang) : '—', wide: needsPlate });
  if (!needsPlate) {
    facts.push({ icon: 'car-outline', label: t.vehicle, value: r.vehiclePlate ?? (fromLink ? t.linkNoPlate : t.notAdded) });
  }
  if (snapshot?.charging) {
    facts.push({
      icon: 'flash-outline',
      label: t.chargingSlot,
      value: `${timeIn(snapshot.charging.start, lang)} – ${timeIn(snapshot.charging.end, lang)}`,
      detail: `${snapshot.charging.connector} · ${chargerNameIn(db.chargers.find((c) => c.id === snapshot.charging?.chargerId)?.label, lang)}`,
      wide: true,
    });
  }

  const directions = (
    <Panel title={t.directions} icon="navigate-outline" subtitle={t.mapHint}>
      <View style={styles.buttonRow}>
        {!inside ? (
          <ParkingButton
            label={t.navigateToGate}
            icon="navigate-outline"
            tone="primary"
            onPress={() => void openExternal(gateMapsUrl(view.gate))}
            style={styles.flex}
          />
        ) : null}
        <ParkingButton
          label={t.openMap}
          icon="map-outline"
          onPress={() => navigation.navigate('ParkingMap', { invite: params.invite, lang, spaceId: view.space.id })}
          style={styles.flex}
        />
      </View>
      {view.zone.indoor ? (
        <AppText variant="label" color={theme.colors.textMuted}>
          {t.indoorNote}
        </AppText>
      ) : null}
    </Panel>
  );

  const charging =
    view.charging && view.allocation && (r.status === 'checked-in' || r.status === 'confirmed') ? (
      <Panel title={t.charging} icon="flash-outline" subtitle={t.chargingState[view.charging.state]}>
        <InfoRow
          icon="battery-charging-outline"
          label={t.chargingSlot}
          value={`${timeIn(view.allocation.start, lang)} – ${timeIn(view.allocation.end, lang)}`}
          detail={`${view.connector?.type} · ${chargerNameIn(view.charger?.label, lang)}`}
        />
        {projection && view.charging.state !== 'reserved' ? (
          <>
            <ProgressBar progress={projection.progress} height={8} />
            <AppText variant="label" color={theme.colors.textSupport}>
              {`${t.delivered(projection.energyKwh, projection.targetKwh)} ${t.demoValues}`}
            </AppText>
          </>
        ) : null}
        {view.charging.state === 'reserved' ? (
          <AppText variant="label" color={theme.colors.textSupport}>
            {t.enterDoesntCharge}
          </AppText>
        ) : null}
        {view.charging.state === 'waiting-for-plug-in' ? (
          <ParkingButton
            label={t.plugIn}
            icon="flash-outline"
            tone="primary"
            loading={busy === 'plug'}
            disabled={Date.parse(view.allocation.start) > now}
            onPress={() => void run('plug', () => service.plugInFromPass(params.invite), t.plugInDone)}
          />
        ) : null}
        {view.charging.state === 'charging' ? (
          <ParkingButton
            label={t.stop}
            icon="stop-circle-outline"
            loading={busy === 'stop'}
            onPress={() => void run('stop', () => service.stopChargingFromPass(params.invite), t.stopDone)}
          />
        ) : null}
        {moveOutBy && r.status === 'checked-in' && !r.bayVacatedAt ? (
          <Notice tone="warning">{t.moveOut(view.space.label, timeIn(moveOutBy, lang))}</Notice>
        ) : null}
      </Panel>
    ) : null;

  return (
    <ParkingFrame {...frame}>
      {alerts.map((n) => {
        const alert = alertText(n);
        return (
          <Notice key={n.id} tone="warning" title={alert.title}>
            {alert.body}
          </Notice>
        );
      })}
      {r.needsReassignment && r.status === 'confirmed' ? (
        <Notice tone="warning" title={t.bayMayChangeTitle}>
          {t.bayMayChangeBody}
        </Notice>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {/* The gate won't open without a plate, so this comes before everything else. */}
      {needsPlate ? (
        <Panel title={t.addPlateTitle} icon="car-outline" subtitle={t.addPlateBody}>
          <Field
            label={t.plateLabel}
            value={plate}
            onChangeText={setPlate}
            placeholder={t.platePlaceholder}
            autoCapitalize="characters"
            autoCorrect={false}
            icon="car-outline"
          />
          <ParkingButton
            compact
            label={t.saveVehicle}
            tone="primary"
            icon="checkmark-outline"
            loading={busy === 'plate'}
            onPress={() => void run('plate', () => service.addVehicleFromPass(params.invite, plate), t.vehicleSaved)}
          />
        </Panel>
      ) : null}

      <Panel
        title={t.welcome(r.guest?.name)}
        subtitle={rangeIn(r.scheduledStart, r.scheduledEnd, lang)}
        icon="qr-code-outline"
        trailing={<StatusChip label={t.status[statusKey]} tone={view.status.tone} glow />}
      >
        {showQr ? (
          <>
            <PassQr
              value={view.credential!.displayToken}
              size={176}
              accessibilityLabel={t.qrLabel}
              qrRef={(source) => {
                qrSource.current = source;
              }}
            />
            <AppText variant="caption" align="center" color={theme.colors.textSecondary}>
              {caption}
            </AppText>
          </>
        ) : (
          <AppText variant="body" color={theme.colors.textSecondary}>
            {fromLink && statusKey === 'completed' ? t.linkEnded : (t.closedMessage[statusKey] ?? t.notActive)}
          </AppText>
        )}
        <FactGrid facts={facts} />
        {showQr ? (
          <>
            <ParkingButton compact label={t.saveQr} icon="download-outline" loading={busy === 'save'} onPress={() => void saveQr()} />
            <AppText variant="label" color={theme.colors.textMuted}>
              {t.saveQrNote}
            </AppText>
          </>
        ) : null}
      </Panel>

      {/* Inside, charging matters more than the way in. */}
      {inside ? charging : null}
      {r.status === 'confirmed' || inside ? directions : null}
      {!inside ? charging : null}

      <Panel title={t.help} icon="help-buoy-outline">
        <View style={styles.buttonRow}>
          <ParkingButton compact label={t.contactSecurity} icon="call-outline" onPress={() => setShowSecurity((v) => !v)} style={styles.flex} />
          {!fromLink ? (
            <ParkingButton
              compact
              label={t.spaceOccupied}
              icon="alert-circle-outline"
              loading={busy === 'occupied'}
              onPress={() => void run('occupied', () => service.requestHelp(params.invite, 'space-occupied'), t.helpSent)}
              style={styles.flex}
            />
          ) : null}
        </View>
        {showSecurity ? (
          <View style={styles.security}>
            {/* Isolated left to right, so the number's groups keep their order inside Arabic. */}
            <InfoRow icon="shield-checkmark-outline" label={t.securityDesk} value={`⁦${siteInfo.securityPhone}⁩`} />
            <View style={styles.buttonRow}>
              <ParkingButton
                compact
                label={t.call}
                icon="call-outline"
                onPress={() => void openExternal(`tel:${siteInfo.securityPhone.replace(/\s/g, '')}`)}
                style={styles.flex}
              />
              {!fromLink ? (
                <ParkingButton
                  compact
                  label={t.askCall}
                  icon="chatbubble-outline"
                  loading={busy === 'contact'}
                  onPress={() => void run('contact', () => service.requestHelp(params.invite, 'contact'), t.helpSent)}
                  style={styles.flex}
                />
              ) : null}
            </View>
          </View>
        ) : null}
      </Panel>

      <AppText variant="label" color={theme.colors.textMuted} style={styles.footer}>
        {`${fromLink ? `${t.linkNote} ` : ''}${siteInfo.compoundName} · ${t.footer(r.reference, lang === 'ar' ? `${dateIn(now, 'ar', false)}، ${timeIn(now, 'ar')}` : formatDateTime(now))}. ${t.fictionalGates}`}
      </AppText>
    </ParkingFrame>
  );
}
