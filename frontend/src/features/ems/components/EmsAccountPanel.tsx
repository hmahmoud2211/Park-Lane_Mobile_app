import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import { useEms } from '../hooks/useEms';
import type { AppTheme } from '../../../types/theme.types';
import type { RootStackParamList } from '../../../types/navigation.types';
import { AppButton } from '../../../components/common/AppButton';
import { AppText } from '../../../components/common/AppText';
import { Notice } from '../../../components/feedback/Notice';
import { NeonPanel } from '../../../components/ui/NeonPanel';
import { PanelHeading } from '../../../components/ui/PanelHeading';

const BUTTON_HEIGHT = 48;

/**
 * The resident's account where smart-home screens show it: who is signed in, or for a guest
 * a way to the login screen, the only place the app signs in.
 */
export function EmsAccountPanel({ intro }: { intro: string }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { status, user, configured, signOut, sessionNotice } = useEms();

  if (status === 'signedIn') {
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading title="EMS account" iconSet="material" iconName="account-circle-outline" divider />
        <View style={styles.signedIn}>
          <View style={styles.flex}>
            <AppText variant="statValue">{user?.name ?? 'Signed in'}</AppText>
            {user ? (
              <AppText variant="tileCaption" color={theme.colors.textSupport}>
                {user.email}
              </AppText>
            ) : null}
          </View>
          <AppButton title="Sign out" variant="secondary" height={40} onPress={() => void signOut()} style={styles.signOut} />
        </View>
      </NeonPanel>
    );
  }

  return (
    <NeonPanel style={styles.panel}>
      <PanelHeading title="EMS account" iconSet="material" iconName="account-circle-outline" subtitle={intro} divider />
      {!configured ? (
        <Notice tone="warning" title="Backend not set up">
          This build has no EMS backend address (EXPO_PUBLIC_DEVICE_BACKEND_URL).
        </Notice>
      ) : status === 'loading' ? (
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          Checking your session…
        </AppText>
      ) : (
        <View style={styles.form}>
          {sessionNotice ? <Notice tone="info">{sessionNotice}</Notice> : null}
          <AppButton
            title="Sign in"
            height={BUTTON_HEIGHT}
            onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })}
          />
        </View>
      )}
    </NeonPanel>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    panel: {
      padding: theme.spacing.md - 2,
      gap: theme.spacing.md - 4,
    },
    flex: {
      flex: 1,
    },
    signedIn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md - 4,
    },
    signOut: {
      paddingHorizontal: theme.spacing.md,
    },
    form: {
      gap: theme.spacing.md - 4,
    },
  });
}
