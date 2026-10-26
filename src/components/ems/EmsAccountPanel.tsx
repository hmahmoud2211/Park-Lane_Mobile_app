import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useEms } from '../../hooks/useEms';
import { EmsError } from '../../services/ems/emsApi';
import type { AppTheme } from '../../types/theme.types';
import { AppButton } from '../common/AppButton';
import { AppInput } from '../common/AppInput';
import { AppText } from '../common/AppText';
import { Notice } from '../parking/Notice';
import { FilterChip } from '../ui/FilterChip';
import { NeonPanel } from '../ui/NeonPanel';
import { PanelHeading } from '../ui/PanelHeading';

type Mode = 'signIn' | 'create';

const FIELD_HEIGHT = 54;
const BUTTON_HEIGHT = 48;

/**
 * The EMS account that owns the devices and that Alexa links to. Separate
 * from the app's own login screen, which is still frontend-only: devices and
 * Alexa need a real account on the backend.
 */
export function EmsAccountPanel({ intro }: { intro: string }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { status, user, configured, signIn, createAccount, signOut, sessionNotice } = useEms();
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!email.trim() || password.length < 8) {
      setError('Enter your email and a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signIn') {
        await signIn(email.trim(), password);
      } else {
        await createAccount(name.trim(), email.trim(), password);
      }
      setPassword('');
    } catch (caught) {
      setError(caught instanceof EmsError ? caught.message : 'Could not reach the EMS backend.');
    } finally {
      setBusy(false);
    }
  }, [mode, name, email, password, signIn, createAccount]);

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
          <View style={styles.modes} accessibilityRole="tablist">
            <FilterChip
              label="Sign in"
              iconSet="ionicons"
              iconName="log-in-outline"
              selected={mode === 'signIn'}
              onPress={() => setMode('signIn')}
            />
            <FilterChip
              label="Create account"
              iconSet="ionicons"
              iconName="person-add-outline"
              selected={mode === 'create'}
              onPress={() => setMode('create')}
            />
          </View>
          {mode === 'create' ? (
            <AppInput
              variant="field"
              label="Name"
              value={name}
              onChangeText={setName}
              autoComplete="name"
              height={FIELD_HEIGHT}
            />
          ) : null}
          <AppInput
            variant="field"
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            height={FIELD_HEIGHT}
          />
          <AppInput
            variant="field"
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            onSubmitEditing={() => void submit()}
            height={FIELD_HEIGHT}
          />
          {error ? (
            <AppText variant="tileCaption" color={theme.colors.error} accessibilityRole="alert">
              {error}
            </AppText>
          ) : null}
          <AppButton
            title={mode === 'signIn' ? 'Sign in' : 'Create account'}
            variant="gradient"
            height={BUTTON_HEIGHT}
            loading={busy}
            disabled={busy}
            onPress={() => void submit()}
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
    modes: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
  });
}
