import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { ChipGroup, FactGrid, InfoRow, type Fact } from '../../components/parking/Controls';
import { GuestTrackerStrip } from '../../components/parking/GuestTrackerCard';
import { Notice, type NoticeTone } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ParkingFrame } from '../../components/parking/ParkingFrame';
import { Timeline } from '../../components/parking/Rows';
import { chargingStateLabel } from '../../components/parking/presenters';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import type { Lang } from '../../services/parking/i18n';
import { siteInfo } from '../../services/parking/policy';
import { findReservation, inviteUrl, reservationView } from '../../services/parking/selectors';
import { MINUTE_MS, formatDateTime, formatRange, formatTime, ms } from '../../services/parking/time';
import { encodePassSnapshot } from '../../services/parking/passLink';
import { guestTracker, type ShareChannel } from '../../services/parking/tracking';
import { ParkingError } from '../../services/parking/tx';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  copyText,
  internationalDigits,
  openLink,
  shareOutcomeMessage,
  shareText,
  whatsappUrl,
} from '../../utils/share';
import {
  EXTEND_OPTIONS,
  MESSAGE_LANGUAGES,
  bookedSendTitle,
  detailsCopy as copy,
  openFailed,
  passLink,
  passMessage,
  sendTo,
  timelineFor,
} from './ReservationDetailsScreen.data';
import { createStyles } from './ReservationDetailsScreen.styles';

type Confirming = 'cancel' | 'replace' | null;

/**
 * One booking, most important first: who, when and where with where the
 * visit stands; then the one job left (send the pass, or charge); then
 * changes. Directions live on the map page and the full log behind a tap,
 * so nothing is said twice.
 */
export function ReservationDetailsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'ReservationDetails'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'ReservationDetails'>['route']>();
  const { db, now, service, inviteOrigin, storageKind } = useParking();
  const [message, setMessage] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [showActivity, setShowActivity] = useState(false);

  const reservation = findReservation(db, params.reservationId);
  const view = useMemo(() => (reservation ? reservationView(db, reservation, now) : null), [db, reservation, now]);
  const timeline = useMemo(() => (reservation ? timelineFor(db, reservation) : []), [db, reservation]);

  if (!reservation || !view) {
    return (
      <ParkingFrame title={copy.title}>
        <Notice tone="warning" title="Booking not found">
          It may have been removed when the demo data was reset.
        </Notice>
      </ParkingFrame>
    );
  }

  const r = reservation;
  const live = r.status === 'confirmed' || r.status === 'checked-in';
  const isGuest = r.bookedFor === 'guest';
  const link = view.invitation ? passLink(inviteUrl(inviteOrigin, view.invitation), lang, encodePassSnapshot(view)) : undefined;
  const phoneDigits = internationalDigits(r.guest?.phone, siteInfo.countryCallingCode);
  const firstName = r.guest?.name.trim().split(/\s+/)[0] ?? 'your guest';
  const [gateShort, gateRest] = view.gate.name.split(' · ');

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ParkingError ? e.message : 'That did not work. Please try again.' });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  /** Logs how the pass went out, for the tracker. Never blocks the share itself. */
  const recordShare = (channel: ShareChannel) => service.recordShare(r.id, channel).catch(() => undefined);

  const sendWhatsApp = async () => {
    if (!link) return;
    const opened = await openLink(whatsappUrl(`${passMessage(view, lang)}\n${link}`, phoneDigits));
    if (opened) {
      await recordShare('whatsapp');
    }
    setMessage(opened ? { tone: 'info', text: copy.whatsappOpened } : { tone: 'error', text: openFailed('WhatsApp') });
  };
  const sharePass = async () => {
    if (!link) return;
    const outcome = await shareText('Parking pass', passMessage(view, lang), link);
    if (outcome === 'shared' || outcome === 'copied') {
      await recordShare(outcome === 'shared' ? 'share' : 'copy');
    }
    setMessage({ tone: outcome === 'failed' ? 'error' : 'info', text: shareOutcomeMessage(outcome, 'Pass link') });
  };
  const copyLink = async () => {
    if (!link) return;
    const ok = await copyText(link);
    if (ok) {
      await recordShare('copy');
    }
    setMessage({ tone: ok ? 'info' : 'error', text: ok ? 'Link copied.' : `Could not copy. The link is: ${link}` });
  };

  /** Only what needs attention gets a banner; the good news is said where the next step is. */
  const statusNotice = () => {
    if (r.needsReassignment) {
      return (
        <Notice
          tone="warning"
          title="This booking needs another bay"
          actions={
            <ParkingButton
              compact
              tone="primary"
              icon="swap-horizontal-outline"
              label="Move to the nearest free bay"
              loading={busy === 'reassign'}
              onPress={() => void run('reassign', () => service.reassign(r.id, 'resident'), 'Moved. The pass and directions now show the new bay.')}
            />
          }
        >
          {r.needsReassignment.reason}
        </Notice>
      );
    }
    if (view.overdue) {
      return (
        <Notice tone="error" title={`Overdue since ${formatTime(r.scheduledEnd)}`}>
          {`${view.title} is still parked in ${view.space.label}. The bay stays held until the car leaves. Extend below if the bay is free, or ask your guest to leave.`}
        </Notice>
      );
    }
    if (r.status === 'no-show') {
      return (
        <Notice tone="warning" title="Guest did not arrive">
          {`Arrival was held until ${formatTime(r.noShowAt!)}. The space was released and the pass no longer works.`}
        </Notice>
      );
    }
    if (params.justBooked && !isGuest) {
      return <Notice tone="success" title={copy.justBooked}>Your EV bay and charger are reserved.</Notice>;
    }
    if (params.justEdited) {
      return <Notice tone="success" title={copy.justEdited}>{isGuest ? copy.justEditedBody : 'Your EV bay and charger are updated.'}</Notice>;
    }
    return null;
  };

  const extendTo = (minutes: number) => ms(r.scheduledEnd) + minutes * MINUTE_MS;

  const actual = [
    r.actualEntryAt ? `In ${formatTime(r.actualEntryAt)}` : '',
    r.bayVacatedAt && !r.actualExitAt ? `left bay ${formatTime(r.bayVacatedAt)}` : '',
    r.actualExitAt ? `out ${formatTime(r.actualExitAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const facts: Fact[] = [
    { icon: 'time-outline', label: 'When (Cairo)', value: formatRange(r.scheduledStart, r.scheduledEnd), detail: actual || undefined, wide: true },
    { icon: 'location-outline', label: 'Bay', value: view.space.label, detail: `${view.zone.name} · ${view.zone.level}` },
    { icon: 'enter-outline', label: 'Entrance', value: gateShort, detail: gateRest },
    { icon: 'car-outline', label: 'Vehicle', value: r.vehiclePlate ?? 'Guest adds it', wide: true },
  ];

  const sendCard =
    isGuest && link && live ? (
      <Panel
        title={params.justBooked ? bookedSendTitle(firstName) : copy.sendTitle}
        icon="paper-plane-outline"
        subtitle={r.guest?.phone && phoneDigits ? sendTo(r.guest.phone) : copy.noPhoneShort}
      >
        <ChipGroup fill options={MESSAGE_LANGUAGES} value={lang} onChange={setLang} />
        <ParkingButton label="Send on WhatsApp" icon="logo-whatsapp" tone="primary" onPress={() => void sendWhatsApp()} />
        <View style={styles.row}>
          <ParkingButton compact label="Share" icon="share-social-outline" onPress={() => void sharePass()} style={styles.grow} />
          <ParkingButton compact label="Copy link" icon="link-outline" onPress={() => void copyLink()} style={styles.grow} />
          <ParkingButton
            compact
            label="Preview"
            icon="eye-outline"
            onPress={() => navigation.navigate('GuestPass', { invite: view.invitation!.inviteToken, lang })}
            style={styles.grow}
          />
        </View>
        <AppText variant="label" color={theme.colors.textMuted}>
          {storageKind !== 'memory' ? `${copy.sendNote} ${copy.localOnlyShort}` : copy.sendNote}
        </AppText>
      </Panel>
    ) : null;
  // Until the pass is out, sending it is the one job left, so it leads.
  const sendFirst = r.status === 'confirmed' && !db.audit.some((a) => a.entityId === r.id && a.action === 'pass.shared');

  return (
    <ParkingFrame title={copy.title}>
      {statusNotice()}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {sendFirst ? sendCard : null}

      <Panel
        title={view.title}
        subtitle={`${r.reference} · ${view.property.label}`}
        icon={r.parkingType === 'ev' ? 'flash-outline' : 'people-outline'}
        trailing={<StatusChip label={view.status.label} tone={view.status.tone} glow />}
      >
        <FactGrid facts={facts} />
        {isGuest ? (
          <View style={styles.divided}>
            <GuestTrackerStrip tracker={guestTracker(db, r, now)} />
          </View>
        ) : null}
        <View style={styles.row}>
          <ParkingButton
            compact
            label={copy.directions}
            icon="map-outline"
            onPress={() => navigation.navigate('ParkingMap', { reservationId: r.id })}
            style={styles.grow}
          />
          {timeline.length > 0 ? (
            <ParkingButton
              compact
              label={showActivity ? 'Hide activity' : `Activity (${timeline.length})`}
              icon={showActivity ? 'chevron-up' : 'list-outline'}
              onPress={() => setShowActivity((v) => !v)}
              style={styles.grow}
            />
          ) : null}
        </View>
        {showActivity ? <Timeline items={timeline} /> : null}
        {isGuest ? (
          <AppText variant="label" color={theme.colors.textMuted}>
            {copy.trackerNote}
          </AppText>
        ) : null}
      </Panel>

      {!sendFirst ? sendCard : null}

      {view.allocation && view.charging ? (
        <Panel title="Charging" icon="flash-outline" subtitle={chargingStateLabel[view.charging.state]}>
          <InfoRow
            icon="battery-charging-outline"
            label="Charging slot"
            value={`${formatTime(view.allocation.start)}–${formatTime(view.allocation.end)}`}
            detail={`${view.charger?.label} · ${view.connector?.type}${view.allocation.targetKwh ? ` · ${view.allocation.targetKwh} kWh requested` : ''}`}
          />
          {r.status === 'checked-in' || view.charging.state !== 'reserved' ? (
            <ParkingButton compact label="Open charging session" icon="speedometer-outline" onPress={() => navigation.navigate('ChargingSession', { reservationId: r.id })} />
          ) : null}
        </Panel>
      ) : null}

      {live ? (
        <Panel title="Manage" icon="settings-outline">
          {r.status === 'confirmed' ? (
            <View style={styles.row}>
              <ParkingButton
                compact
                label="Edit"
                icon="create-outline"
                onPress={() => navigation.navigate('ReserveParking', { mode: r.parkingType === 'ev' ? 'ev' : 'guest', reservationId: r.id })}
                style={styles.grow}
              />
              {isGuest ? <ParkingButton compact label="Replace QR" icon="refresh-outline" onPress={() => setConfirming('replace')} style={styles.grow} /> : null}
              <ParkingButton compact label="Cancel" icon="close-circle-outline" tone="danger" onPress={() => setConfirming('cancel')} style={styles.grow} />
            </View>
          ) : null}

          {!r.bayVacatedAt ? (
            <View style={styles.extend}>
              <AppText variant="label" color={theme.colors.textSupport}>
                {`Extend (ends ${formatTime(r.scheduledEnd)})`}
              </AppText>
              <View style={styles.row}>
                {EXTEND_OPTIONS.map((minutes) => (
                  <ParkingButton
                    key={minutes}
                    compact
                    label={`+${minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}`}
                    loading={busy === `extend-${minutes}`}
                    onPress={() =>
                      void run(`extend-${minutes}`, () => service.extendReservation(r.id, extendTo(minutes), r.version), `Extended to ${formatTime(extendTo(minutes))}.`)
                    }
                    style={styles.grow}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {r.status === 'checked-in' ? (
            <AppText variant="label" color={theme.colors.textMuted}>
              The visitor is inside. The visit ends when they exit, or when security records it.
            </AppText>
          ) : null}

          {confirming ? (
            <Notice
              tone="warning"
              title={confirming === 'cancel' ? 'Cancel booking?' : 'Replace QR?'}
              actions={
                <>
                  <ParkingButton compact label="Keep it" onPress={() => setConfirming(null)} />
                  <ParkingButton
                    compact
                    tone={confirming === 'cancel' ? 'danger' : 'primary'}
                    label={confirming === 'cancel' ? 'Yes, cancel' : 'Issue new QR'}
                    loading={busy === confirming}
                    onPress={() =>
                      void (confirming === 'cancel'
                        ? run('cancel', () => service.cancelReservation(r.id), 'Booking cancelled. The pass no longer works.')
                        : run('replace', () => service.replacePass(r.id), 'New QR issued. Share the pass again; the old QR is refused at the gate.'))
                    }
                  />
                </>
              }
            >
              {confirming === 'cancel' ? copy.cancelConfirm : copy.replaceConfirm}
            </Notice>
          ) : null}
        </Panel>
      ) : (
        <>
          {r.status === 'cancelled' || r.status === 'completed' ? (
            <AppText variant="label" color={theme.colors.textSupport} style={styles.endNote}>
              {r.status === 'cancelled'
                ? `Cancelled ${formatDateTime(r.cancelledAt!)}. The pass no longer works.`
                : 'Visit completed. The pass can’t be used again.'}
            </AppText>
          ) : null}
          <ParkingButton
            label="Book again"
            icon="repeat-outline"
            tone="primary"
            onPress={() => navigation.navigate('ReserveParking', { mode: r.parkingType === 'ev' ? 'ev' : 'guest' })}
          />
        </>
      )}
    </ParkingFrame>
  );
}
