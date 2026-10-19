import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { CheckRow, ChipGroup, Field, Stepper, type ChipOption } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ParkingFrame } from '../../components/parking/ParkingFrame';
import { ListRow } from '../../components/parking/Rows';
import { SiteMap, type BayMark } from '../../components/parking/site-map/SiteMap';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import { searchSpaces, type SpaceOption } from '../../services/parking/availability';
import { chargingRateKw } from '../../services/parking/charging';
import { validateRequest, type ReservationInput } from '../../services/parking/reservations';
import { findReservation, myParking } from '../../services/parking/selectors';
import {
  addDaysToKey,
  cairoDateKey,
  cairoMinuteOfDay,
  formatDuration,
  formatMinuteOfDay,
  formatRange,
  formatTime,
  ms,
  relativeDayLabel,
} from '../../services/parking/time';
import { ParkingError } from '../../services/parking/tx';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  CONNECTORS,
  ENERGY_TARGETS,
  LIST_PREVIEW,
  STAY_PRESETS,
  STEPS,
  chargingWindow,
  endOf,
  initialForm,
  nextSlot,
  reserveCopy as copy,
  startOf,
  stepTitles,
  type ReserveForm,
  type Step,
} from './ReserveParkingScreen.data';
import { createStyles } from './ReserveParkingScreen.styles';

const ORDINAL_WORDS = ['Nearest', '2nd nearest', '3rd nearest'];

/**
 * Booking in two steps: who and when on one page, then the space (list or
 * site map) with a confirm button. Also used to edit an upcoming booking.
 */
export function ReserveParkingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'ReserveParking'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'ReserveParking'>['route']>();
  const { db, now, residentId, service } = useParking();
  const scrollRef = useRef<ScrollView>(null);

  const editing = useMemo(() => findReservation(db, params.reservationId), [db, params.reservationId]);
  // The version the edit started from: a change elsewhere in the meantime is refused, not overwritten.
  const [editVersion] = useState(() => editing?.version);
  const mine = useMemo(() => myParking(db, residentId), [db, residentId]);
  const policy = db.policy;
  const mode = editing ? (editing.parkingType === 'ev' ? 'ev' : 'guest') : params.mode;

  const [form, setForm] = useState<ReserveForm>(() => initialForm(db, now, mode, mine.properties.map((p) => p.id), editing));
  const [step, setStep] = useState<Step>('details');
  const [error, setError] = useState<{ message: string; code?: string; field?: 'name' | 'plate' } | null>(null);
  // The map leads: residents pick by where the bay is. The list is one tap away.
  const [view, setView] = useState<'list' | 'map'>('map');
  const [showAll, setShowAll] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [showContact, setShowContact] = useState(() => Boolean(editing?.guest?.phone || editing?.guest?.email));
  const [busy, setBusy] = useState(false);

  const moveOutBuffer = policy.evMoveOutBufferMinutes;
  const update = (patch: Partial<ReserveForm>) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (next.parkingType === 'ev' && next.stayFollowsCharging) {
        next.stayMin = next.chargeOffsetMin + next.chargeMin + moveOutBuffer;
      }
      return next;
    });
    setError(null);
  };

  const isEv = form.parkingType === 'ev';
  const isGuest = form.bookedFor === 'guest';
  const evVehicles = mine.vehicles.filter((v) => v.ev);
  const vehicle = evVehicles.find((v) => v.id === form.vehicleId);
  const start = startOf(form);
  const end = endOf(form);
  const { start: chargeStart, end: chargeEnd } = chargingWindow(form);
  const property = db.properties.find((p) => p.id === form.propertyId);

  const toInput = (spaceId: string): ReservationInput => ({
    propertyId: form.propertyId,
    residentId,
    bookedFor: form.bookedFor,
    guest: isGuest ? { name: form.guestName, phone: form.guestPhone || undefined, email: form.guestEmail || undefined } : undefined,
    vehiclePlate: isGuest ? (form.visitorAddsVehicle ? undefined : form.plate) : vehicle?.plate,
    vehicleId: isGuest ? undefined : vehicle?.id,
    parkingType: form.parkingType,
    start,
    end,
    spaceId,
    charging:
      isEv && form.connectorType
        ? {
            connectorType: form.connectorType,
            start: chargeStart,
            end: chargeEnd,
            targetKwh: form.targetKwh === 'none' ? undefined : Number(form.targetKwh),
          }
        : undefined,
  });

  // Re-run on every render: it is cheap, and bookings or the clock may have moved.
  const options =
    step === 'space'
      ? searchSpaces(
          db,
          {
            propertyId: form.propertyId,
            kind: isEv ? 'ev' : 'visitor',
            start,
            end,
            connectorType: form.connectorType ?? undefined,
            chargingStart: isEv ? chargeStart : undefined,
            chargingEnd: isEv ? chargeEnd : undefined,
            excludeReservationId: editing?.id,
          },
          now,
        )
      : [];
  const available = options.filter((o) => o.available);
  const unavailable = options.filter((o) => !o.available);
  const recommended = available[0];
  // The resident's pick (or, when editing, the booking's own bay) while it is free
  // for the whole time; otherwise the recommended, nearest free space.
  const picked = form.spaceId ? options.find((o) => o.space.id === form.spaceId && o.available) : undefined;
  const chosen = picked ?? recommended;
  const pickedLabel = db.spaces.find((sp) => sp.id === form.spaceId)?.label;
  const pickLost = Boolean(form.spaceId) && !picked && options.length > 0;

  /* -------------------------------------------------------- Navigation */

  const goTo = (next: Step) => {
    setError(null);
    setStep(next);
  };
  // Each step starts at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [step]);

  const validateDetails = (): { message: string; field?: 'name' | 'plate' } | null => {
    if (isGuest && !form.guestName.trim()) return { message: 'Enter your guest’s name.', field: 'name' };
    if (isGuest && !form.visitorAddsVehicle && !form.plate.trim()) {
      return { message: 'Enter the plate, or tick “Visitor will add vehicle details”.', field: 'plate' };
    }
    if (!isGuest && !vehicle) return { message: 'Choose the vehicle to charge.' };
    if (isEv && !form.connectorType) return { message: 'Choose the connector the car needs.' };
    try {
      validateRequest(db, toInput(form.spaceId ?? ''), now, editing?.id);
      return null;
    } catch (e) {
      return { message: e instanceof ParkingError ? e.message : 'Check the details and try again.' };
    }
  };

  const findSpace = () => {
    const problem = validateDetails();
    if (problem) {
      setError(problem);
      return;
    }
    setShowAll(false);
    goTo('space');
  };

  const back = () => (step === 'details' ? navigation.goBack() : goTo('details'));

  const confirm = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const input = toInput(chosen.space.id);
      const saved = editing
        ? await service.editReservation(
            editing.id,
            {
              start: input.start,
              end: input.end,
              spaceId: input.spaceId,
              guest: input.guest,
              vehiclePlate: input.vehiclePlate ?? '',
              charging: input.charging,
            },
            editVersion,
          )
        : await service.createReservation(input);
      navigation.replace(
        'ReservationDetails',
        editing ? { reservationId: saved.id, justEdited: true } : { reservationId: saved.id, justBooked: true },
      );
    } catch (e) {
      const err = e instanceof ParkingError ? e : null;
      setError({ message: err?.message ?? 'Could not save the booking. Please try again.', code: err?.code });
      setBusy(false);
    }
  };

  /* ------------------------------------------------------ Time controls */

  // The earliest arrival on a date: the next slot today, or the booking's own start when editing.
  const earliest = Math.min(nextSlot(now, policy), editing ? ms(editing.scheduledStart) : Number.POSITIVE_INFINITY);
  const earliestArrivalOn = (dateKey: string) => {
    const floorKey = cairoDateKey(earliest);
    if (dateKey === floorKey) return cairoMinuteOfDay(earliest);
    return dateKey < floorKey ? 24 * 60 : 0;
  };
  const minArrival = earliestArrivalOn(form.dateKey);
  const today = cairoDateKey(now);
  const dateOptions: ChipOption<string>[] = Array.from({ length: policy.bookingHorizonDays }, (_, i) => {
    const key = addDaysToKey(today, i);
    return { value: key, label: relativeDayLabel(key, now), disabled: earliestArrivalOn(key) >= 24 * 60 };
  });
  const slot = policy.slotMinutes;
  const maxStay = isEv ? policy.maxEvParkingDurationMinutes : policy.maxStandardDurationMinutes;
  const minStay = isEv ? form.chargeOffsetMin + form.chargeMin : 30;
  const crossesDay = cairoDateKey(end) !== form.dateKey;

  /* ---------------------------------------------------------- Step 1 */

  const title = editing ? copy.editTitle : mode === 'ev' ? copy.evTitle : copy.guestTitle;
  const stepIndex = STEPS.indexOf(step);

  const renderDetails = () => (
    <>
      <Panel title={isGuest ? 'Guest' : 'Your vehicle'} icon={isGuest ? 'person-outline' : 'car-outline'}>
        {mine.properties.length > 1 && !editing ? (
          <ChipGroup
            label="Property"
            options={mine.properties.map((p) => ({ value: p.id, label: p.label }))}
            value={form.propertyId}
            onChange={(propertyId) => update({ propertyId, spaceId: null })}
          />
        ) : null}
        {mode === 'ev' && !editing ? (
          <ChipGroup
            label="Charging for"
            options={[
              { value: 'resident', label: 'My vehicle', icon: 'person-outline' },
              { value: 'guest', label: 'A visitor', icon: 'people-outline' },
            ]}
            value={form.bookedFor}
            onChange={(bookedFor) => update({ bookedFor })}
          />
        ) : null}

        {isGuest ? (
          <>
            <Field
              label="Guest name"
              value={form.guestName}
              onChangeText={(guestName) => update({ guestName })}
              placeholder="Full name"
              autoCapitalize="words"
              autoComplete="name"
              icon="person-outline"
              error={error?.field === 'name' ? error.message : undefined}
            />
            {showContact ? (
              <>
                <Field
                  label="Mobile (optional)"
                  value={form.guestPhone}
                  onChangeText={(guestPhone) => update({ guestPhone })}
                  placeholder="+20 10 1234 5678"
                  keyboardType="phone-pad"
                  icon="call-outline"
                />
                <Field
                  label="Email (optional)"
                  value={form.guestEmail}
                  onChangeText={(guestEmail) => update({ guestEmail })}
                  placeholder="name@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  icon="mail-outline"
                />
              </>
            ) : (
              <Pressable onPress={() => setShowContact(true)} accessibilityRole="button" style={styles.linkRow}>
                <Ionicons name="add-circle-outline" size={18} color={theme.colors.accent} />
                <AppText variant="bodyStrong" color={theme.colors.accent}>
                  {copy.addContact}
                </AppText>
              </Pressable>
            )}
            {!form.visitorAddsVehicle ? (
              <Field
                label="Plate number"
                value={form.plate}
                onChangeText={(plate) => update({ plate })}
                placeholder="e.g. EGY 1234"
                autoCapitalize="characters"
                autoCorrect={false}
                icon="car-outline"
                error={error?.field === 'plate' ? error.message : undefined}
              />
            ) : null}
            <CheckRow
              label={copy.vehicleLater}
              detail={copy.vehicleLaterDetail}
              checked={form.visitorAddsVehicle}
              onChange={(visitorAddsVehicle) => update({ visitorAddsVehicle })}
            />
          </>
        ) : (
          <ChipGroup
            label="Electric vehicle"
            options={evVehicles.map((v) => ({ value: v.id, label: `${v.make} ${v.model}`, detail: v.plate }))}
            value={form.vehicleId}
            onChange={(vehicleId) => {
              const choice = evVehicles.find((v) => v.id === vehicleId);
              update({ vehicleId, connectorType: choice?.ev?.connectors[0] ?? null });
            }}
          />
        )}

        {mode === 'guest' && !editing ? (
          <ChipGroup
            label="Parking"
            options={[
              { value: 'standard', label: 'Visitor bay', icon: 'car-outline' },
              { value: 'ev', label: 'EV bay + charging', icon: 'flash-outline' },
            ]}
            value={form.parkingType}
            onChange={(parkingType) => update({ parkingType, spaceId: null, stayFollowsCharging: parkingType === 'ev' })}
          />
        ) : null}
      </Panel>

      <Panel title="When" icon="calendar-outline" subtitle="Cairo time">
        <ChipGroup scroll options={dateOptions} value={form.dateKey} onChange={(dateKey) => update({ dateKey, arrivalMin: Math.max(form.arrivalMin, earliestArrivalOn(dateKey)) })} />
        <Stepper
          label="Arrival"
          display={formatMinuteOfDay(form.arrivalMin)}
          detail={relativeDayLabel(form.dateKey, now)}
          canDecrement={form.arrivalMin - slot >= minArrival}
          canIncrement={form.arrivalMin + slot < 24 * 60}
          onDecrement={() => update({ arrivalMin: form.arrivalMin - slot })}
          onIncrement={() => update({ arrivalMin: form.arrivalMin + slot })}
        />
        {!isEv ? (
          <ChipGroup
            label="How long?"
            options={STAY_PRESETS.filter((m) => m <= maxStay).map((m) => ({ value: String(m), label: formatDuration(m) }))}
            value={STAY_PRESETS.some((m) => m === form.stayMin) ? String(form.stayMin) : null}
            onChange={(value) => update({ stayMin: Number(value), stayFollowsCharging: false })}
          />
        ) : null}
        <Stepper
          label={isEv ? 'Parking until' : 'Departure'}
          display={formatTime(end)}
          detail={`${formatDuration(form.stayMin)} stay${crossesDay ? ' · ends next day' : ''}`}
          canDecrement={form.stayMin - slot >= minStay}
          canIncrement={form.stayMin + slot <= maxStay}
          onDecrement={() => update({ stayMin: form.stayMin - slot, stayFollowsCharging: false })}
          onIncrement={() => update({ stayMin: form.stayMin + slot, stayFollowsCharging: false })}
        />
      </Panel>

      {isEv ? (
        <Panel title="Charging" icon="flash-outline" subtitle={copy.evDeparture}>
          <ChipGroup
            label="Connector"
            options={CONNECTORS.map((c) => ({
              value: c,
              label: c,
              disabled: !(isGuest ? CONNECTORS : (vehicle?.ev?.connectors ?? CONNECTORS)).includes(c),
            }))}
            value={form.connectorType}
            onChange={(connectorType) => update({ connectorType })}
          />
          <Stepper
            label="Charging starts"
            display={formatTime(chargeStart)}
            detail={form.chargeOffsetMin === 0 ? 'On arrival' : `${formatDuration(form.chargeOffsetMin)} after arrival`}
            canDecrement={form.chargeOffsetMin - slot >= 0}
            canIncrement={form.chargeOffsetMin + slot + form.chargeMin <= maxStay}
            onDecrement={() => update({ chargeOffsetMin: form.chargeOffsetMin - slot })}
            onIncrement={() => update({ chargeOffsetMin: form.chargeOffsetMin + slot })}
          />
          <Stepper
            label="Charging ends"
            display={formatTime(chargeEnd)}
            detail={`${formatDuration(form.chargeMin)} of charging`}
            canDecrement={form.chargeMin - slot >= 30}
            canIncrement={form.chargeMin + slot <= policy.maxChargingDurationMinutes && form.chargeOffsetMin + form.chargeMin + slot <= maxStay}
            onDecrement={() => update({ chargeMin: form.chargeMin - slot })}
            onIncrement={() => update({ chargeMin: form.chargeMin + slot })}
          />
          <ChipGroup
            label="Energy to add (optional)"
            options={ENERGY_TARGETS.map((t) => ({ value: t, label: t === 'none' ? 'Until slot ends' : `${t} kWh` }))}
            value={form.targetKwh}
            onChange={(targetKwh) => update({ targetKwh })}
          />
        </Panel>
      ) : null}
    </>
  );

  /* ---------------------------------------------------------- Step 2 */

  const marks: Record<string, BayMark> = {};
  const reasons: Record<string, string> = {};
  for (const o of options) {
    marks[o.space.id] = o.available ? 'free' : 'taken';
    if (o.reason) reasons[o.space.id] = o.reason;
  }

  const zoneLine = (o: SpaceOption) => {
    const zone = db.zones.find((z) => z.id === o.space.zoneId);
    return `${zone?.name} · ${zone?.level}`;
  };

  // The chosen bay first, then the nearest others; the rest behind "Show more".
  const ordered = chosen ? [chosen, ...available.filter((o) => o !== chosen)] : available;
  const listed = showAll ? ordered : ordered.slice(0, LIST_PREVIEW);

  const renderSpace = () => {
    const zone = chosen ? db.zones.find((z) => z.id === chosen.space.zoneId) : undefined;
    const connector = db.connectors.find((c) => c.id === chosen?.connectorId);
    const charger = db.chargers.find((c) => c.id === connector?.chargerId);
    const rate = charger ? chargingRateKw(charger, vehicle) : 0;
    const target = form.targetKwh === 'none' ? null : Number(form.targetKwh);
    return (
      <>
        <Pressable onPress={() => goTo('details')} accessibilityRole="button" accessibilityLabel="Edit visit details">
          <Panel>
            <View style={styles.summary}>
              <View style={styles.summaryBadge}>
                <Ionicons name="calendar-outline" size={18} color={theme.colors.textPrimary} />
              </View>
              <View style={styles.summaryText}>
                <AppText variant="bodyStrong">
                  {isGuest ? `${form.guestName.trim()} · ${form.visitorAddsVehicle ? 'plate to follow' : form.plate.trim().toUpperCase()}` : `${vehicle?.make} ${vehicle?.model} · ${vehicle?.plate}`}
                </AppText>
                <AppText variant="label" color={theme.colors.textSupport}>
                  {`${formatRange(start, end)} (${formatDuration(form.stayMin)})`}
                </AppText>
                {isEv ? (
                  <AppText variant="label" color={theme.colors.textSupport}>
                    {`Charging ${formatTime(chargeStart)}–${formatTime(chargeEnd)} · ${form.connectorType}`}
                  </AppText>
                ) : null}
              </View>
              <AppText variant="bodyStrong" color={theme.colors.accent}>
                Edit
              </AppText>
            </View>
          </Panel>
        </Pressable>

        {pickLost && chosen ? (
          <Notice tone="warning" title={`${pickedLabel} isn’t free for the new time`}>
            {`${chosen.space.label} is selected instead.`}
          </Notice>
        ) : null}

        <ChipGroup
          options={[
            { value: 'list', label: 'List', icon: 'list-outline' },
            { value: 'map', label: 'Map', icon: 'map-outline' },
          ]}
          value={view}
          onChange={setView}
        />

        {view === 'map' ? (
          <SiteMap
            framed
            db={db}
            now={now}
            mode="select"
            marks={marks}
            reasons={reasons}
            targetSpaceId={chosen?.space.id}
            onSelectSpace={(spaceId) => update({ spaceId })}
          />
        ) : (
          <Panel
            title="Available for your visit"
            icon="checkmark-circle-outline"
            subtitle={`${available.length} of ${options.length} ${isEv ? 'EV bays' : 'visitor bays'} are free the whole time`}
          >
            {available.length === 0 ? (
              <AppText variant="caption" color={theme.colors.textSecondary}>
                {`${copy.noSpace}. ${copy.noSpaceDetail}`}
              </AppText>
            ) : (
              listed.map((o, index) => {
                const selected = o === chosen;
                const rank = available.indexOf(o);
                return (
                  <ListRow
                    key={o.space.id}
                    divided={index > 0}
                    icon={selected ? 'radio-button-on' : 'radio-button-off'}
                    title={`${o.space.label}${o === recommended ? ' · Recommended' : ''}`}
                    lines={[zoneLine(o), `${ORDINAL_WORDS[rank] ?? `${rank + 1}th nearest`} to ${property?.label}`]}
                    statusLabel={selected ? 'Selected' : undefined}
                    statusTone={selected ? 'teal' : undefined}
                    onPress={() => update({ spaceId: o.space.id })}
                  />
                );
              })
            )}
            {ordered.length > LIST_PREVIEW ? (
              <ParkingButton
                compact
                icon={showAll ? 'chevron-up' : 'chevron-down'}
                label={showAll ? 'Show fewer' : `Show ${ordered.length - LIST_PREVIEW} more`}
                onPress={() => setShowAll((v) => !v)}
              />
            ) : null}
          </Panel>
        )}

        {unavailable.length > 0 && view === 'list' ? (
          <View>
            <Pressable
              onPress={() => setShowUnavailable((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showUnavailable }}
              style={styles.linkRow}
            >
              <Ionicons name={showUnavailable ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textSupport} />
              <AppText variant="label" color={theme.colors.textSupport}>
                {`${unavailable.length} bays not available for this time`}
              </AppText>
            </Pressable>
            {showUnavailable ? (
              <Panel>
                {unavailable.map((o, index) => (
                  <ListRow key={o.space.id} divided={index > 0} icon="remove-circle-outline" title={o.space.label} lines={[o.reason ?? 'Unavailable']} />
                ))}
              </Panel>
            ) : null}
          </View>
        ) : null}

        {chosen && isEv && charger ? (
          <Notice>
            {`${chosen.space.label} charges on ${charger.label}${target ? `: ${target} kWh in about ${formatDuration((target / Math.max(rate, 0.1)) * 60)} at ~${rate} kW` : ''}. ${copy.estimateNote}`}
          </Notice>
        ) : null}
        {chosen ? (
          <AppText variant="label" color={theme.colors.textMuted} style={styles.note}>
            {`${chosen.space.label} · ${zone?.name}. ${copy.autoConfirm}`}
          </AppText>
        ) : null}
      </>
    );
  };

  /** The pinned card under step 2: the bay picked on the map or list, and the button that books it. */
  const renderSelected = () => {
    const space = chosen?.space;
    const zone = space ? db.zones.find((z) => z.id === space.zoneId) : undefined;
    const building = space ? db.buildings.find((b) => b.id === space.buildingId) : undefined;
    const ev = space?.kind === 'ev';
    return (
      <Panel>
        <View style={styles.selected} accessibilityLiveRegion="polite">
          <View style={[styles.selectedBadge, !space && styles.selectedBadgeEmpty]}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {space ? space.label : '—'}
            </AppText>
            {ev ? <Ionicons name="flash" size={14} color={theme.colors.success} /> : null}
          </View>
          <View style={styles.summaryText}>
            <AppText variant="label" color={theme.colors.chipVioletText}>
              {space ? 'Selected' : copy.noSpace}
            </AppText>
            <AppText variant="subheading">{space ? space.label : copy.noSpaceDetail}</AppText>
            {space ? (
              <AppText variant="label" color={theme.colors.textSupport}>
                {[zone?.level, building ? `Near ${building.name}` : zone?.name].filter(Boolean).join(' · ')}
              </AppText>
            ) : null}
          </View>
        </View>
        <ParkingButton
          label={space ? `${editing ? 'Save' : 'Confirm'} ${space.label}` : 'Change the time'}
          icon={space ? 'checkmark-circle-outline' : 'time-outline'}
          tone="primary"
          loading={busy}
          disabled={editing ? editing.status !== 'confirmed' : false}
          onPress={() => {
            if (space) void confirm();
            else goTo('details');
          }}
        />
      </Panel>
    );
  };

  const footer =
    step === 'details' ? (
      <ParkingButton label="Find a space" icon="search-outline" tone="primary" onPress={findSpace} />
    ) : (
      renderSelected()
    );

  return (
    <ParkingFrame
      title={step === 'space' ? copy.chooseTitle : title}
      subtitle={`Step ${stepIndex + 1} of ${STEPS.length}${step === 'details' ? ` · ${stepTitles.details}` : ''}`}
      onBack={back}
      scrollRef={scrollRef}
      bottomBar={false}
      footer={footer}
    >

      {editing && editing.status !== 'confirmed' ? (
        <Notice tone="warning" title="This booking can no longer be edited">
          Only upcoming bookings can be changed.
        </Notice>
      ) : null}

      {step === 'details' ? renderDetails() : renderSpace()}

      {error && !error.field ? (
        <Notice
          tone="error"
          title="Not booked yet"
          actions={
            step === 'space' && (error.code === 'space-unavailable' || error.code === 'charger-unavailable') ? (
              <ParkingButton compact label="Pick another space" onPress={() => setError(null)} />
            ) : undefined
          }
        >
          {error.message}
        </Notice>
      ) : null}

    </ParkingFrame>
  );
}
