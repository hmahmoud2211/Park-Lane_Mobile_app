import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  /** Buttons under the text. */
  actions?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const ICONS: Record<NoticeTone, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle-outline',
  success: 'checkmark-circle-outline',
  warning: 'alert-circle-outline',
  error: 'close-circle-outline',
};

/** A tinted callout for a result, a warning or a demo explanation. */
export function Notice({ tone = 'info', title, children, actions, style }: NoticeProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const look = toneLook(theme, tone);

  return (
    <View
      style={[styles.box, { backgroundColor: look.fill, borderColor: look.stroke }, style]}
      accessibilityRole={tone === 'error' || tone === 'warning' ? 'alert' : undefined}
    >
      <View style={styles.row}>
        <Ionicons name={ICONS[tone]} size={20} color={look.icon} style={styles.icon} />
        <View style={styles.text}>
          {title ? <AppText variant="bodyStrong">{title}</AppText> : null}
          {typeof children === 'string' ? (
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {children}
            </AppText>
          ) : (
            children
          )}
        </View>
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/** A tone's fill, rim and icon colours, shared with other tinted parts such as the guest tracker. */
export function toneLook(theme: AppTheme, tone: NoticeTone) {
  const { colors } = theme;
  switch (tone) {
    case 'success':
      return { fill: colors.successFill, stroke: colors.successStroke, icon: colors.success };
    case 'warning':
      return { fill: colors.warningFill, stroke: colors.warningStroke, icon: colors.warning };
    case 'error':
      return { fill: colors.errorFill, stroke: colors.errorStroke, icon: colors.error };
    case 'info':
      return { fill: colors.infoFill, stroke: colors.infoStroke, icon: colors.accent };
  }
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    box: {
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      padding: 12,
      gap: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    icon: {
      marginTop: 1,
    },
    text: {
      flex: 1,
      gap: 3,
    },
    // A column: AppButton sizes from its container, so each action spans the notice.
    actions: {
      gap: 8,
    },
  });
}
