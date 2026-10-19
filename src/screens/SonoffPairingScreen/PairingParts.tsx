import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { PairingError } from '../../types/sonoff.types';
import { errorAdvice, pairingCopy as copy, type AdviceAction } from './SonoffPairingScreen.data';
import { ACTION_HEIGHT, ACTION_RADIUS, NOTE_ICON_SIZE, createStyles } from './SonoffPairingScreen.styles';

/** The screens' gradient CTA, as on Maintenance's "New Request". */
export function PrimaryAction({
  title,
  onPress,
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  return (
    <AppButton
      title={title}
      variant="gradient"
      gradientColors={[theme.colors.ctaSky, theme.colors.ctaRoyal, theme.colors.ctaViolet, theme.colors.ctaPink]}
      height={ACTION_HEIGHT}
      radius={ACTION_RADIUS}
      labelVariant="statValue"
      disabled={disabled}
      loading={loading}
      onPress={onPress}
      style={style}
    />
  );
}

/** The quieter button: a glass ring, as on the Add Device sheet. */
export function SecondaryAction({
  title,
  onPress,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [style, (pressed || disabled) && styles.pressed]}
    >
      <GlassSurface
        radius={ACTION_RADIUS}
        stroke="gradient"
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        blurred={false}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.outline}
      >
        {icon ? <Ionicons name={icon} size={NOTE_ICON_SIZE} color={theme.colors.textPrimary} /> : null}
        <AppText variant="statValue" numberOfLines={1}>
          {title}
        </AppText>
      </GlassSurface>
    </Pressable>
  );
}

/** A text-only action, e.g. "Join from Wi-Fi settings instead". */
export function TextAction({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <AppText variant="statLabel" color={theme.colors.textAccentSoft}>
        {title}
      </AppText>
    </Pressable>
  );
}

export type NoticeTone = 'info' | 'warning' | 'error' | 'success';

const NOTICE_ICONS: Record<NoticeTone, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle-outline',
  warning: 'flask-outline',
  error: 'alert-circle-outline',
  success: 'checkmark-circle-outline',
};

/** A tinted callout with an optional title and actions. */
export function Notice({
  tone,
  title,
  children,
  actions,
  style,
}: {
  tone: NoticeTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const toneStyle = {
    info: styles.noticeInfo,
    warning: styles.noticeWarning,
    error: styles.noticeError,
    success: styles.noticeSuccess,
  }[tone];
  const iconColor = {
    info: theme.colors.electricCyan,
    warning: theme.colors.warning,
    error: theme.colors.error,
    success: theme.colors.success,
  }[tone];

  return (
    <View style={[styles.notice, toneStyle, style]} accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}>
      <Ionicons name={NOTICE_ICONS[tone]} size={NOTE_ICON_SIZE} color={iconColor} />
      <View style={styles.noticeText}>
        {title ? <AppText variant="statValue">{title}</AppText> : null}
        {typeof children === 'string' ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {children}
          </AppText>
        ) : (
          children
        )}
        {actions ? <View style={styles.noticeActions}>{actions}</View> : null}
      </View>
    </View>
  );
}

/**
 * What happened, then what to do about it: the hook's specific message, the
 * advice for its kind, "Try again", and the kind's own fix if it has one.
 */
export function ErrorNotice({
  error,
  onRetry,
  onAction,
  unavailableActions = [],
  style,
}: {
  error: PairingError;
  onRetry?: () => void;
  onAction?: (action: AdviceAction) => void;
  /** Fixes this platform cannot offer, e.g. a Wi-Fi settings link on iOS. */
  unavailableActions?: readonly AdviceAction[];
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  const advice = errorAdvice[error.kind];
  const action = advice.action && onAction && !unavailableActions.includes(advice.action) ? advice.action : null;
  const actionLabels: Record<AdviceAction, string> = {
    appSettings: 'Open Settings',
    wifiSettings: copy.openWifiSettings,
    editWifi: copy.editWifi,
    startOver: copy.startOver,
  };

  return (
    <Notice
      tone="error"
      title={advice.title}
      style={style}
      actions={
        onRetry || action ? (
          <>
            {onRetry ? <TextAction title={copy.retry} onPress={onRetry} /> : null}
            {action && onAction ? (
              <TextAction title={actionLabels[action]} onPress={() => onAction(action)} />
            ) : null}
          </>
        ) : undefined
      }
    >
      <AppText variant="tileCaption" color={theme.colors.textPrimary}>
        {error.message}
      </AppText>
      <AppText variant="tileCaption" color={theme.colors.textSupport}>
        {advice.advice}
      </AppText>
    </Notice>
  );
}
