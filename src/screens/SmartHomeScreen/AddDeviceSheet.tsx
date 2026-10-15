import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { cubeConfig } from '../../constants/cubeConfig';
import { useAppTheme } from '../../hooks/useAppTheme';
import { CubeApiError, addCamera, setZigbeePairing } from '../../services/cube/cubeApi';
import type { CubeDevice } from '../../services/cube/cube.types';
import type { AppTheme } from '../../types/theme.types';
import { addDeviceCopy as copy } from './SmartHomeScreen.data';

export interface AddDeviceSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Re-reads the hub's devices; resolves to the list, or null if the hub is unreachable. */
  refresh: () => Promise<CubeDevice[] | null>;
}

/*
 * Not in the design. Built from the screen's own parts: a glass panel like
 * AppMenu's, option rows on the device cards' badge, and Visitor Access's
 * compact fields and gradient CTA.
 */
const PANEL_MAX_WIDTH = 420;
const BADGE_SIZE = 30;
const BADGE_ICON_SIZE = 17;
const CLOSE_ICON_SIZE = 20;
const FIELD_HEIGHT = 44;
const BUTTON_HEIGHT = 40;
const OPEN_ICON_SIZE = 15;

type Notice = { tone: 'info' | 'success' | 'error'; text: string } | null;

function errorText(error: unknown): string {
  return error instanceof CubeApiError ? error.message : 'Something went wrong with the smart home hub.';
}

/** Lets the resident add a Zigbee device, a camera or a Wi-Fi device to the unit's CUBE hub. */
export function AddDeviceSheet({ visible, onClose, refresh }: AddDeviceSheetProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Zigbee pairing: the hub adds whatever joins; this counts what is new.
  const [pairing, setPairing] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [pairingNotice, setPairingNotice] = useState<Notice>(null);
  const knownSerials = useRef<Set<string>>(new Set());
  const pairingRef = useRef(false);

  const [cameraName, setCameraName] = useState('');
  const [cameraUrl, setCameraUrl] = useState('');
  const [cameraErrors, setCameraErrors] = useState<{ name?: string; url?: string }>({});
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraNotice, setCameraNotice] = useState<Notice>(null);

  const stopPairing = useCallback(async (reason: Notice = null) => {
    if (!pairingRef.current) {
      return;
    }
    pairingRef.current = false;
    setPairing(false);
    setSecondsLeft(0);
    if (reason) {
      setPairingNotice(reason);
    }
    // Best effort: the hub also stops on its own when the window runs out.
    await setZigbeePairing(false).catch(() => undefined);
  }, []);

  const startPairing = useCallback(async () => {
    setPairingBusy(true);
    setPairingNotice(null);
    try {
      const before = await refresh();
      knownSerials.current = new Set((before ?? []).map((device) => device.serial_number));
      await setZigbeePairing(true);
      pairingRef.current = true;
      setPairing(true);
      setSecondsLeft(cubeConfig.pairingSeconds);
      setPairingNotice({ tone: 'info', text: copy.zigbeeSearching });
    } catch (caught) {
      setPairingNotice({ tone: 'error', text: errorText(caught) });
    } finally {
      setPairingBusy(false);
    }
  }, [refresh]);

  // While pairing: count down, and re-read the list to report devices as they join.
  useEffect(() => {
    if (!pairing) {
      return undefined;
    }
    const endsAt = Date.now() + cubeConfig.pairingSeconds * 1000;
    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        void stopPairing();
      }
    }, 1000);
    const poll = setInterval(async () => {
      const list = await refresh();
      const added = (list ?? []).filter((device) => !knownSerials.current.has(device.serial_number));
      if (added.length > 0 && pairingRef.current) {
        setPairingNotice({ tone: 'success', text: copy.zigbeeFound(added.length) });
      }
    }, cubeConfig.pairingPollMs);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [pairing, refresh, stopPairing]);

  // Leaving the sheet, or the screen, ends the search.
  const handleClose = useCallback(() => {
    void stopPairing();
    onClose();
  }, [onClose, stopPairing]);
  useEffect(() => () => void stopPairing(), [stopPairing]);

  const submitCamera = useCallback(async () => {
    const name = cameraName.trim();
    const streamUrl = cameraUrl.trim();
    const scheme = /^(rtsp|http):\/\//i.exec(streamUrl)?.[1]?.toLowerCase();
    const errors = {
      name: name ? undefined : copy.cameraNameMissing,
      url: scheme ? undefined : copy.cameraUrlInvalid,
    };
    setCameraErrors(errors);
    setCameraNotice(null);
    if (errors.name || errors.url) {
      return;
    }

    setCameraBusy(true);
    try {
      // The hub takes RTSP streams, and ESP32 cameras over plain HTTP.
      await addCamera({ name, streamUrl, protocol: scheme === 'rtsp' ? 'RTSP' : 'ESP32-CAM' });
      setCameraName('');
      setCameraUrl('');
      setCameraNotice({ tone: 'success', text: copy.cameraAdded });
      await refresh();
    } catch (caught) {
      setCameraNotice({ tone: 'error', text: errorText(caught) });
    } finally {
      setCameraBusy(false);
    }
  }, [cameraName, cameraUrl, refresh]);

  const noticeColor = (tone: NonNullable<Notice>['tone']) =>
    tone === 'error' ? theme.colors.error : tone === 'success' ? theme.colors.success : theme.colors.textSupport;

  const notice = (value: Notice) =>
    value ? (
      <AppText
        variant="tileCaption"
        color={noticeColor(value.tone)}
        style={styles.notice}
        accessibilityLiveRegion="polite"
      >
        {value.text}
      </AppText>
    ) : null;

  const optionHeading = (iconSet: 'material' | 'ionicons', iconName: string, title: string, body: string) => (
    <View style={styles.optionHeading}>
      <View style={styles.badge}>
        <AppIcon set={iconSet} name={iconName} size={BADGE_ICON_SIZE} />
      </View>
      <View style={styles.optionText}>
        <AppText variant="statValue">{title}</AppText>
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {body}
        </AppText>
      </View>
    </View>
  );

  const ctaColors = [
    theme.colors.ctaSky,
    theme.colors.ctaRoyal,
    theme.colors.ctaViolet,
    theme.colors.ctaPink,
  ] as const;

  const minutes = Math.floor(secondsLeft / 60);
  const countdown = `${minutes}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} accessibilityLabel={copy.close}>
          {/* Swallows taps on the panel so they do not dismiss it. */}
          <Pressable style={styles.panelWrap} onPress={(event) => event.stopPropagation()}>
            <GlassSurface radius={theme.borderRadius.lg} style={styles.panel}>
              <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.header}>
                  <View style={styles.flex}>
                    <AppText variant="sectionTitle" accessibilityRole="header">
                      {copy.title}
                    </AppText>
                    <AppText variant="tileCaption" color={theme.colors.textSupport}>
                      {copy.subtitle}
                    </AppText>
                  </View>
                  <Pressable
                    onPress={handleClose}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={copy.close}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <Ionicons name="close" size={CLOSE_ICON_SIZE} color={theme.colors.textPrimary} />
                  </Pressable>
                </View>

                <GlassSurface
                  radius={theme.borderRadius.sm}
                  blurred={false}
                  strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
                  fillOpacity={theme.glass.subtleFillOpacity}
                  style={styles.option}
                >
                  {optionHeading('ionicons', 'radio-outline', copy.zigbeeTitle, copy.zigbeeBody)}
                  {pairing ? (
                    <OutlineButton
                      title={`${copy.zigbeeStop} (${countdown})`}
                      onPress={() => void stopPairing()}
                    />
                  ) : (
                    <AppButton
                      title={copy.zigbeeStart}
                      variant="gradient"
                      gradientColors={ctaColors}
                      height={BUTTON_HEIGHT}
                      labelVariant="statValue"
                      loading={pairingBusy}
                      onPress={() => void startPairing()}
                      style={styles.action}
                    />
                  )}
                  {notice(pairingNotice)}
                </GlassSurface>

                <GlassSurface
                  radius={theme.borderRadius.sm}
                  blurred={false}
                  strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
                  fillOpacity={theme.glass.subtleFillOpacity}
                  style={styles.option}
                >
                  {optionHeading('ionicons', 'videocam-outline', copy.cameraTitle, copy.cameraBody)}
                  <AppInput
                    variant="field"
                    height={FIELD_HEIGHT}
                    label={copy.cameraName}
                    placeholder={copy.cameraNamePlaceholder}
                    value={cameraName}
                    onChangeText={setCameraName}
                    error={cameraErrors.name}
                    containerStyle={styles.field}
                    returnKeyType="next"
                  />
                  <AppInput
                    variant="field"
                    height={FIELD_HEIGHT}
                    label={copy.cameraUrl}
                    placeholder={copy.cameraUrlPlaceholder}
                    value={cameraUrl}
                    onChangeText={setCameraUrl}
                    error={cameraErrors.url}
                    containerStyle={styles.field}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="done"
                    onSubmitEditing={() => void submitCamera()}
                  />
                  <AppButton
                    title={copy.cameraAdd}
                    variant="gradient"
                    gradientColors={ctaColors}
                    height={BUTTON_HEIGHT}
                    labelVariant="statValue"
                    loading={cameraBusy}
                    onPress={() => void submitCamera()}
                    style={styles.action}
                  />
                  {notice(cameraNotice)}
                </GlassSurface>

                <GlassSurface
                  radius={theme.borderRadius.sm}
                  blurred={false}
                  strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
                  fillOpacity={theme.glass.subtleFillOpacity}
                  style={styles.option}
                >
                  {optionHeading('ionicons', 'wifi-outline', copy.wifiTitle, copy.wifiBody)}
                  <OutlineButton
                    title={copy.wifiOpen}
                    onPress={() => void Linking.openURL(cubeConfig.hubUrl)}
                    trailing={
                      <Ionicons name="open-outline" size={OPEN_ICON_SIZE} color={theme.colors.textPrimary} />
                    }
                  />
                </GlassSurface>
              </ScrollView>
            </GlassSurface>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The quieter of the sheet's two buttons: a glass ring, as on the screen's round controls. */
function OutlineButton({
  title,
  onPress,
  trailing,
}: {
  title: string;
  onPress: () => void;
  trailing?: ReactNode;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <GlassSurface
        radius={BUTTON_HEIGHT / 2}
        stroke="gradient"
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        blurred={false}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.outline}
      >
        <AppText variant="statValue">{title}</AppText>
        {trailing}
      </GlassSurface>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xxl,
      backgroundColor: theme.colors.scrimTop,
    },
    panelWrap: {
      width: '100%',
      maxWidth: PANEL_MAX_WIDTH,
      maxHeight: '100%',
      alignSelf: 'center',
    },
    panel: {
      maxHeight: '100%',
    },
    content: {
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
    },
    option: {
      padding: theme.spacing.sm,
    },
    optionHeading: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    badge: {
      width: BADGE_SIZE,
      height: BADGE_SIZE,
      borderRadius: theme.borderRadius.sm,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.avatarStroke,
      backgroundColor: theme.colors.avatarFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionText: {
      flex: 1,
      marginLeft: theme.spacing.sm,
    },
    field: {
      marginTop: theme.spacing.sm,
    },
    action: {
      marginTop: theme.spacing.sm,
    },
    outline: {
      height: BUTTON_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
    },
    notice: {
      marginTop: theme.spacing.sm,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
