import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type { MediaCapability, PowerCapability, PressCapability } from '../../../types/home.types';
import type { AppTheme } from '../../../types/theme.types';
import { AppIcon } from '../../../components/common/AppIcon';
import { AppText } from '../../../components/common/AppText';
import { GlassSurface } from '../../../components/common/GlassSurface';
import { playPauseAction, remoteKeyOf, volumeCommand, type RemoteKey } from '../services/controlPlan';
import { percentText, sourceLabel } from '../services/deviceLabels';
import type { ControlKit } from '../types';
import { ChoiceGroup, keyOf } from './ControlParts';

export interface TvRemoteProps {
  media?: MediaCapability;
  power?: PowerCapability;
  /** The TV's remote keys (gateway `button` settings: up, ok, back, channel_up, info, exit…). */
  remote: readonly PressCapability[];
  kit: ControlKit;
}

const copy = {
  turnOn: 'Turn the TV on to use the remote.',
  input: 'Input',
  chooseInput: 'Choose what to watch',
} as const;

/** Big text never pushes a key's caption out of the remote body. */
const CAPTION_SCALE_CAP = 1.6;

/**
 * A TV's controls laid out like the remote in the hand: one tall rounded body with Power,
 * Input and Settings on top, a round D-pad around a big OK, Back · Home · Info, the VOL and CH
 * rockers either side of Mute, then Previous · Play · Next. Every key is always in its place;
 * a key the TV doesn't offer, and every key but Power while the TV is off, is greyed.
 */
export function TvRemote({ media, power, remote, kit }: TvRemoteProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // The inputs show under the remote; the Input key folds them away and back.
  const [inputsOpen, setInputsOpen] = useState(true);
  const off = power?.value === 'off' || media?.state === 'off';
  const keysOff = kit.disabled || off;

  const pressOf = (name: RemoteKey) => remote.find((capability) => remoteKeyOf(capability.entityId) === name);
  const keyProps = (name: RemoteKey) => {
    const capability = pressOf(name);
    return {
      busy: capability ? kit.isBusy(keyOf(capability, 'press')) : false,
      disabled: keysOff || !capability,
      waiting: kit.waiting,
      onPress: () => capability && kit.send(capability, 'press'),
    };
  };

  const powerKey = power ? `${power.entityId}:power` : null;
  const powerAction = power?.value === 'on' ? 'off' : power?.value === 'off' ? 'on' : 'toggle';
  const down = media ? volumeCommand(media, -1) : null;
  const up = media ? volumeCommand(media, 1) : null;
  const volumeKey = (direction: 1 | -1) => (media ? keyOf(media, direction > 0 ? 'volume_up' : 'volume_down') : '');
  const playPause = media ? playPauseAction(media) : null;
  const playing = media?.state === 'playing' || media?.state === 'buffering';
  const hasInputs = Boolean(media && media.sources.length > 0) && !keysOff;
  const exit = keyProps('exit');
  const status = [
    media?.volume !== null && media?.volume !== undefined ? `Volume ${percentText(media.volume * 100)}${media.muted ? ' (muted)' : ''}` : null,
    media?.source ? `${copy.input}: ${sourceLabel(media.source)}` : null,
  ].filter(Boolean);

  const mediaKey = (action: string, icon: string, label: string, can: boolean) =>
    media ? (
      <RoundKey
        icon={icon}
        label={label}
        busy={kit.isBusy(keyOf(media, action))}
        disabled={keysOff || !can}
        waiting={kit.waiting}
        onPress={() => kit.send(media, action)}
      />
    ) : (
      <RoundKey icon={icon} label={label} disabled onPress={() => undefined} />
    );

  return (
    <View style={styles.root}>
      <GlassSurface
        radius={theme.borderRadius.xl}
        stroke="gradient"
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        blurred={false}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.body}
      >
        <View style={styles.row3}>
          <RoundKey
            icon="power"
            label="Power"
            spoken={power ? `Turn ${powerAction === 'toggle' ? 'on or off' : powerAction} ${kit.deviceName}` : 'Power'}
            valueText={power?.value === 'on' ? 'On' : power?.value === 'off' ? 'Off' : undefined}
            tone="danger"
            busy={powerKey ? kit.isBusy(powerKey) : false}
            // A TV that is off can often still be woken, so Power works even while it is not responding.
            disabled={!power}
            waiting={kit.waiting}
            onPress={() => power && powerKey && kit.send(power, powerAction, undefined, powerKey)}
          />
          <RoundKey
            icon="swap-horizontal"
            label={copy.input}
            spoken={inputsOpen ? 'Hide the inputs' : copy.chooseInput}
            expanded={hasInputs ? inputsOpen : undefined}
            disabled={!hasInputs}
            waiting={kit.waiting}
            onPress={() => setInputsOpen((open) => !open)}
          />
          <RoundKey icon="cog-outline" label="Settings" spoken="Settings menu" {...keyProps('menu')} />
        </View>

        {off ? (
          <AppText variant="controlLabel" align="center" accessibilityLiveRegion="polite">
            {copy.turnOn}
          </AppText>
        ) : null}

        <Dpad
          up={keyProps('up')}
          down={keyProps('down')}
          left={keyProps('left')}
          right={keyProps('right')}
          ok={keyProps('ok')}
        />

        <View style={styles.row3}>
          <RoundKey icon="arrow-u-left-top" label="Back" {...keyProps('back')} />
          <RoundKey icon="home-outline" label="Home" {...keyProps('home')} />
          <RoundKey icon="information-outline" label="Info" {...keyProps('info')} />
        </View>

        <View style={styles.rockers}>
          <Rocker
            label="VOL"
            upSpoken="Volume up"
            downSpoken="Volume down"
            up={{
              busy: kit.isBusy(volumeKey(1)),
              disabled: keysOff || !up,
              waiting: kit.waiting,
              onPress: () => media && up && kit.send(media, up.action, up.value, volumeKey(1)),
            }}
            down={{
              busy: kit.isBusy(volumeKey(-1)),
              disabled: keysOff || !down,
              waiting: kit.waiting,
              onPress: () => media && down && kit.send(media, down.action, down.value, volumeKey(-1)),
            }}
          />
          <View style={styles.middle}>
            <RoundKey
              icon={media?.muted ? 'volume-off' : 'volume-mute'}
              label={media?.muted ? 'Unmute' : 'Mute'}
              selected={media?.muted === true}
              busy={media ? kit.isBusy(keyOf(media, 'mute')) : false}
              disabled={keysOff || !media || media.muted === null}
              waiting={kit.waiting}
              onPress={() => media && kit.send(media, 'mute', !media.muted, keyOf(media, 'mute'))}
            />
            <Pressable
              onPress={exit.onPress}
              disabled={exit.disabled || exit.waiting || exit.busy}
              accessibilityRole="button"
              accessibilityLabel="Exit"
              accessibilityState={{ disabled: exit.disabled || exit.waiting, busy: exit.busy }}
              style={({ pressed }) => [styles.textKey, pressed && styles.pressed, exit.disabled && styles.dim]}
            >
              {exit.busy ? <ActivityIndicator size="small" color={theme.colors.textPrimary} /> : null}
              <AppText variant="controlLabel" color={theme.colors.textSupport} maxFontSizeMultiplier={CAPTION_SCALE_CAP}>
                Exit
              </AppText>
            </Pressable>
          </View>
          <Rocker label="CH" upSpoken="Channel up" downSpoken="Channel down" up={keyProps('channel_up')} down={keyProps('channel_down')} />
        </View>

        <View style={styles.row3}>
          {mediaKey('previous', 'skip-previous', 'Previous', Boolean(media?.canPrevious))}
          {media ? (
            <RoundKey
              icon={playing ? 'pause' : 'play'}
              label={playing ? 'Pause' : 'Play'}
              busy={kit.isBusy(keyOf(media, 'play_pause'))}
              disabled={keysOff || !playPause}
              waiting={kit.waiting}
              onPress={() => playPause && kit.send(media, playPause, undefined, keyOf(media, 'play_pause'))}
            />
          ) : (
            <RoundKey icon="play" label="Play" disabled onPress={() => undefined} />
          )}
          {mediaKey('next', 'skip-next', 'Next', Boolean(media?.canNext))}
        </View>
      </GlassSurface>

      {status.length > 0 && !keysOff ? (
        <AppText variant="controlLabel" align="center" accessibilityLiveRegion="polite">
          {status.join('  ·  ')}
        </AppText>
      ) : null}
      {inputsOpen && hasInputs && media ? (
        <ChoiceGroup
          label={copy.chooseInput}
          choices={media.sources.map((source) => ({ value: source, label: sourceLabel(source) }))}
          selected={media.source}
          busyValue={media.sources.find((source) => kit.isBusy(keyOf(media, 'select_source', source))) ?? null}
          disabled={keysOff}
          waiting={kit.waiting}
          onPick={(source) => kit.send(media, 'select_source', source)}
        />
      ) : null}
    </View>
  );
}

interface KeyState {
  busy?: boolean;
  disabled?: boolean;
  waiting?: boolean;
  onPress: () => void;
}

interface RoundKeyProps extends KeyState {
  icon: string;
  /** The short caption under the key. */
  label: string;
  /** What a screen reader says, when it differs from the caption. */
  spoken?: string;
  valueText?: string;
  tone?: 'normal' | 'danger';
  selected?: boolean;
  expanded?: boolean;
}

/** A round remote key with its caption under it. */
function RoundKey({ icon, label, spoken, valueText, tone = 'normal', selected = false, expanded, busy = false, disabled = false, waiting = false, onPress }: RoundKeyProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const size = theme.layout.tvRemote.roundKey;
  const danger = tone === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || waiting || busy}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityValue={valueText ? { text: valueText } : undefined}
      accessibilityState={{ disabled: disabled || waiting, busy, selected, expanded }}
      style={[styles.roundKey, disabled && styles.dim]}
    >
      {({ pressed }) => (
        <>
          <GlassSurface
            radius={size / 2}
            stroke="gradient"
            glow={selected}
            strokeColors={
              danger
                ? [theme.colors.error, theme.colors.emergencyStroke]
                : selected
                  ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]
                  : [theme.colors.dividerSubtle, theme.colors.dividerSubtle]
            }
            blurred={false}
            fillOpacity={selected ? undefined : theme.glass.subtleFillOpacity}
            style={[styles.roundFace, danger ? styles.dangerFace : styles.idleFace, pressed && styles.pressedFace]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.colors.textPrimary} />
            ) : (
              <AppIcon set="material" name={icon} size={theme.layout.tvRemote.keyIcon} color={danger ? theme.colors.error : theme.colors.textPrimary} />
            )}
          </GlassSurface>
          <AppText variant="controlCaption" color={theme.colors.textSupport} align="center" maxFontSizeMultiplier={CAPTION_SCALE_CAP}>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

const ARROWS = [
  { side: 'up', icon: 'chevron-up', spoken: 'Up' },
  { side: 'right', icon: 'chevron-right', spoken: 'Right' },
  { side: 'down', icon: 'chevron-down', spoken: 'Down' },
  { side: 'left', icon: 'chevron-left', spoken: 'Left' },
] as const;

/** The round D-pad: four arrow segments of a ring around a big OK. */
function Dpad({ up, down, left, right, ok }: Record<'up' | 'down' | 'left' | 'right' | 'ok', KeyState>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const keys = { up, down, left, right };
  const { dpad, dpadOk } = theme.layout.tvRemote;
  return (
    <View style={styles.dpad} accessibilityLabel="Arrow keys and OK">
      <GlassSurface
        radius={dpad / 2}
        stroke="gradient"
        strokeColors={[theme.colors.dividerSubtle, theme.colors.dividerSubtle]}
        blurred={false}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={[StyleSheet.absoluteFill, styles.idleFace]}
      />
      {ARROWS.map(({ side, icon, spoken }) => {
        const key = keys[side];
        return (
          <Pressable
            key={side}
            onPress={key.onPress}
            disabled={key.disabled || key.waiting || key.busy}
            accessibilityRole="button"
            accessibilityLabel={spoken}
            accessibilityState={{ disabled: key.disabled || key.waiting, busy: key.busy }}
            style={({ pressed }) => [styles.arrow, styles[side], pressed && styles.arrowPressed, key.disabled && styles.dim]}
          >
            {key.busy ? (
              <ActivityIndicator size="small" color={theme.colors.textPrimary} />
            ) : (
              <AppIcon set="material" name={icon} size={theme.layout.tvRemote.okIcon + theme.spacing.xs} />
            )}
          </Pressable>
        );
      })}
      <Pressable
        onPress={ok.onPress}
        disabled={ok.disabled || ok.waiting || ok.busy}
        accessibilityRole="button"
        accessibilityLabel="OK"
        accessibilityState={{ disabled: ok.disabled || ok.waiting, busy: ok.busy }}
        style={[styles.okKey, ok.disabled && styles.dim]}
      >
        {({ pressed }) => (
          <GlassSurface
            radius={dpadOk / 2}
            stroke="gradient"
            glow={!ok.disabled}
            strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
            blurred={false}
            style={[styles.okFace, pressed && styles.pressedFace]}
          >
            {ok.busy ? (
              <ActivityIndicator color={theme.colors.textPrimary} />
            ) : (
              <AppText variant="controlState" maxFontSizeMultiplier={CAPTION_SCALE_CAP}>
                OK
              </AppText>
            )}
          </GlassSurface>
        )}
      </Pressable>
    </View>
  );
}

/** A VOL or CH rocker: + on top, − below, its name between. */
function Rocker({ label, upSpoken, downSpoken, up, down }: { label: string; upSpoken: string; downSpoken: string; up: KeyState; down: KeyState }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const half = (key: KeyState, icon: string, spoken: string) => (
    <Pressable
      onPress={key.onPress}
      disabled={key.disabled || key.waiting || key.busy}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ disabled: key.disabled || key.waiting, busy: key.busy }}
      style={({ pressed }) => [styles.rockerHalf, pressed && styles.arrowPressed, key.disabled && styles.dim]}
    >
      {key.busy ? <ActivityIndicator size="small" color={theme.colors.textPrimary} /> : <AppIcon set="material" name={icon} size={theme.layout.tvRemote.keyIcon} />}
    </Pressable>
  );
  return (
    <GlassSurface
      radius={theme.layout.tvRemote.rockerWidth / 2}
      stroke="gradient"
      strokeColors={[theme.colors.dividerSubtle, theme.colors.dividerSubtle]}
      blurred={false}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={[styles.rocker, styles.idleFace]}
    >
      {half(up, 'plus', upSpoken)}
      <AppText variant="controlLabel" align="center" color={theme.colors.textSupport} maxFontSizeMultiplier={CAPTION_SCALE_CAP} importantForAccessibility="no">
        {label}
      </AppText>
      {half(down, 'minus', downSpoken)}
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme) {
  const remote = theme.layout.tvRemote;
  const ringInset = (remote.dpad - remote.dpadArrowLong) / 2;
  const okInset = (remote.dpad - remote.dpadOk) / 2;
  return StyleSheet.create({
    root: {
      gap: theme.spacing.md - theme.spacing.xs,
    },
    body: {
      width: '100%',
      maxWidth: remote.bodyMaxWidth,
      alignSelf: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.lg,
      gap: theme.spacing.lg,
    },
    row3: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'flex-start',
    },
    roundKey: {
      minWidth: remote.roundKey + theme.spacing.md,
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    roundFace: {
      width: remote.roundKey,
      height: remote.roundKey,
      alignItems: 'center',
      justifyContent: 'center',
    },
    idleFace: {
      backgroundColor: theme.colors.fieldFill,
    },
    dangerFace: {
      backgroundColor: theme.colors.errorFill,
    },
    pressedFace: {
      opacity: 0.8,
      transform: [{ scale: 0.92 }],
    },
    pressed: {
      opacity: 0.7,
    },
    dim: {
      opacity: 0.35,
    },
    dpad: {
      width: remote.dpad,
      height: remote.dpad,
      alignSelf: 'center',
    },
    arrow: {
      position: 'absolute',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.borderRadius.lg,
    },
    arrowPressed: {
      backgroundColor: theme.colors.surfaceSubtle,
    },
    up: {
      top: 0,
      left: ringInset,
      width: remote.dpadArrowLong,
      height: remote.dpadArrowShort,
    },
    down: {
      bottom: 0,
      left: ringInset,
      width: remote.dpadArrowLong,
      height: remote.dpadArrowShort,
    },
    left: {
      left: 0,
      top: ringInset,
      width: remote.dpadArrowShort,
      height: remote.dpadArrowLong,
    },
    right: {
      right: 0,
      top: ringInset,
      width: remote.dpadArrowShort,
      height: remote.dpadArrowLong,
    },
    okKey: {
      position: 'absolute',
      top: okInset,
      left: okInset,
      width: remote.dpadOk,
      height: remote.dpadOk,
    },
    okFace: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rockers: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
    },
    rocker: {
      width: remote.rockerWidth,
      alignItems: 'stretch',
      paddingVertical: theme.spacing.xs,
    },
    rockerHalf: {
      minHeight: remote.rockerHalf,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: remote.rockerWidth / 2,
    },
    middle: {
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    textKey: {
      minHeight: theme.layout.deviceControl.minTarget,
      minWidth: theme.layout.deviceControl.minTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
    },
  });
}
