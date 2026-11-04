import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { useAppTheme } from '../../hooks/useAppTheme';
import { ACTION_HEIGHT, ACTION_RADIUS, NOTE_ICON_SIZE, createStyles } from './LgPairingScreen.styles';

/**
 * The pairing wizard's buttons and callouts, from Master's SONOFF wizard
 * (archive/master-2026-11-04), which the LG wizard shared.
 */

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

export type LgNoticeTone = 'info' | 'warning' | 'error' | 'success';

const NOTICE_ICONS: Record<LgNoticeTone, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle-outline',
  warning: 'flask-outline',
  error: 'alert-circle-outline',
  success: 'checkmark-circle-outline',
};

/** A tinted callout with an optional title and actions. */
export function LgNotice({
  tone,
  title,
  children,
  actions,
  style,
}: {
  tone: LgNoticeTone;
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
