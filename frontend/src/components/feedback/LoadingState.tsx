import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface LoadingStateProps {
  /** Shown under the spinner. Without one, only the spinner is drawn, with nothing around it. */
  label?: string;
  /** `tileCaption` (default) for a short line; `bodySmall`, centred, for a longer message. */
  labelVariant?: 'tileCaption' | 'bodySmall';
  /** Space above and below the spinner and label. */
  inset?: 'sm' | 'md';
  /** Screen readers announce the label when it changes (a step that reports progress). */
  announce?: boolean;
  /** Names the spinner for screen readers, e.g. "Loading brands". */
  accessibilityLabel?: string;
}

/** Something is on its way: the spinner, and optionally what is happening. */
export function LoadingState({ label, labelVariant = 'tileCaption', inset = 'sm', announce = false, accessibilityLabel }: LoadingStateProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (label === undefined) {
    return <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel={accessibilityLabel} />;
  }
  return (
    <View style={[styles.center, inset === 'md' && styles.roomy]} accessibilityLiveRegion={announce ? 'polite' : undefined}>
      <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel={accessibilityLabel} />
      <AppText variant={labelVariant} color={theme.colors.textSupport} align={labelVariant === 'bodySmall' ? 'center' : undefined}>
        {label}
      </AppText>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    center: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
    },
    roomy: {
      paddingVertical: theme.spacing.md,
    },
  });
}
