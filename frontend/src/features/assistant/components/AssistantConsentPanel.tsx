import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '../../../components/common/AppText';
import { NeonPanel } from '../../../components/ui/NeonPanel';
import { ParkingButton } from '../../../components/ui/ParkingButton';
import { legal } from '../../../config/legal';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { layout } from '../../../theme';
import type { AppTheme } from '../../../types/theme.types';

export interface AssistantConsentCopy {
  title: string;
  intro: string;
  points: readonly string[];
  agree: string;
  decline: string;
  privacy: string;
}

export interface AssistantConsentPanelProps {
  copy: AssistantConsentCopy;
  onAgree: () => void;
  onDecline: () => void;
}

/** Nothing is sent to the assistant until the resident agrees here (App Store 5.1.2(i)). */
export function AssistantConsentPanel({ copy, onAgree, onDecline }: AssistantConsentPanelProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <NeonPanel style={styles.panel}>
        <AppText variant="bodyStrong" accessibilityRole="header">
          {copy.title}
        </AppText>
        <AppText variant="bodySmall" color={theme.colors.textSecondary} style={styles.intro}>
          {copy.intro}
        </AppText>
        {copy.points.map((point) => (
          <View key={point} style={styles.point}>
            <AppText variant="bodySmall" color={theme.colors.textSecondary}>
              •
            </AppText>
            <AppText variant="bodySmall" color={theme.colors.textSecondary} style={styles.pointText}>
              {point}
            </AppText>
          </View>
        ))}
        {legal.privacyPolicyUrl ? (
          <AppText
            variant="bodySmall"
            color={theme.colors.textPrimary}
            style={styles.link}
            accessibilityRole="link"
            onPress={() => void WebBrowser.openBrowserAsync(legal.privacyPolicyUrl as string)}
          >
            {copy.privacy}
          </AppText>
        ) : null}
        <ParkingButton label={copy.agree} onPress={onAgree} style={styles.agree} />
        <ParkingButton label={copy.decline} tone="secondary" onPress={onDecline} style={styles.decline} />
      </NeonPanel>
    </ScrollView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingVertical: theme.spacing.md,
      paddingHorizontal: layout.innerScreen.gutter,
    },
    panel: {
      padding: theme.spacing.lg,
    },
    intro: {
      marginTop: theme.spacing.xs,
    },
    point: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    pointText: {
      flex: 1,
    },
    link: {
      marginTop: theme.spacing.md,
      textDecorationLine: 'underline',
    },
    agree: {
      marginTop: theme.spacing.lg,
    },
    decline: {
      marginTop: theme.spacing.sm,
    },
  });
}
