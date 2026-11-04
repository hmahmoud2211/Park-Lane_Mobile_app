import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type { ConnectionStatus, ProvisioningStep } from '../../../types/gateway.types';
import type { AppTheme } from '../../../types/theme.types';
import { AppText } from '../../../components/common/AppText';

const ICON_SIZE = 18;

/**
 * A provisioning session's steps, top to bottom: done, current (with its
 * detail) and still to come. The current step follows the session's state,
 * which only the gateway advances.
 */
export function StepList({ steps, state, failed = false }: { steps: readonly ProvisioningStep[]; state: ConnectionStatus; failed?: boolean }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const finished = state === 'connected';
  const index = finished ? steps.length : Math.max(0, steps.findIndex((step) => step.state === state));

  return (
    <View style={styles.root} accessibilityRole="list">
      {steps.map((step, position) => {
        const done = position < index;
        const current = position === index && !finished;
        const icon: keyof typeof Ionicons.glyphMap = done
          ? 'checkmark-circle'
          : current
            ? failed
              ? 'close-circle'
              : 'radio-button-on'
            : 'ellipse-outline';
        const color = done ? theme.colors.success : current ? (failed ? theme.colors.error : theme.colors.textAccentSoft) : theme.colors.textSupport;
        return (
          <View key={`${step.state}:${position}`} style={styles.row} accessibilityState={{ selected: current }}>
            <Ionicons name={icon} size={ICON_SIZE} color={color} />
            <View style={styles.text}>
              <AppText variant="statValue" color={current ? theme.colors.textPrimary : theme.colors.textSupport}>
                {step.title}
              </AppText>
              {current ? (
                <AppText variant="tileCaption" color={theme.colors.textSupport}>
                  {step.detail}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    root: {
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    text: {
      flex: 1,
      gap: 2,
    },
  });
}
