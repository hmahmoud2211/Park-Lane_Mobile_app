// Imported by subpath: the package root re-exports every icon set, which
// bundles ~2.5MB of unused .ttf fonts.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { Notice } from '../../components/feedback/Notice';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { ParkingButton } from '../../components/ui/ParkingButton';
import { useEms } from '../../features/ems/hooks/useEms';
import { emsErrorText } from '../../features/ems/services/emsHttp';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { deleteAccountCopy as copy } from './DeleteAccountScreen.data';
import { FIELD_HEIGHT, FIELD_ICON_SIZE, createStyles } from './DeleteAccountScreen.styles';

/**
 * Deleting the signed-in account and its data, after the password and an explicit "I understand"
 * (App Store 5.1.1(v), Google Play's account deletion policy). The backend does the deleting
 * (POST /api/auth/delete-account); then the session ends and the app returns to sign-in.
 */
export function DeleteAccountScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'DeleteAccount'>['navigation']>();
  const { status, user, deleteAccount } = useEms();
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password) {
      setFailure(copy.passwordMissing);
      return;
    }
    setFailure(null);
    setBusy(true);
    try {
      await deleteAccount(password);
      // Signed out already; nothing behind this screen belongs to anyone any more.
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (error) {
      setFailure(emsErrorText(error));
      setBusy(false);
    }
  };

  const bullets = (lines: readonly string[]) =>
    lines.map((line) => (
      <View key={line} style={styles.bullet}>
        <AppText variant="bodySmall" color={theme.colors.textSecondary}>
          •
        </AppText>
        <AppText variant="bodySmall" color={theme.colors.textSecondary} style={styles.bulletText}>
          {line}
        </AppText>
      </View>
    ));

  return (
    <InnerScreenFrame contentStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />

      <NeonPanel style={styles.panel}>
        <AppText variant="bodyStrong" accessibilityRole="header" style={styles.sectionHeading}>
          {copy.deletedHeading}
        </AppText>
        {bullets(copy.deleted)}
        <AppText variant="bodyStrong" accessibilityRole="header" style={styles.keptHeading}>
          {copy.keptHeading}
        </AppText>
        {bullets(copy.kept)}
      </NeonPanel>

      {status === 'signedIn' && user ? (
        <View style={styles.form}>
          <AppInput
            placeholder={copy.passwordLabel}
            accessibilityLabel={copy.passwordLabel}
            value={password}
            onChangeText={setPassword}
            height={FIELD_HEIGHT}
            secureTextEntry={!shown}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="done"
            leftIcon={<Ionicons name="lock-closed-outline" size={FIELD_ICON_SIZE} color={theme.colors.textPrimary} />}
            rightIcon={
              <Pressable onPress={() => setShown((value) => !value)} hitSlop={10} accessibilityRole="button" accessibilityLabel={shown ? copy.hide : copy.show}>
                <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={FIELD_ICON_SIZE} color={theme.colors.textPrimary} />
              </Pressable>
            }
          />

          <View style={styles.understandRow}>
            <ToggleSwitch value={understood} onValueChange={setUnderstood} accessibilityLabel={copy.understand} />
            <AppText variant="bodySmall" style={styles.understandText} onPress={() => setUnderstood((value) => !value)}>
              {copy.understand}
            </AppText>
          </View>

          {failure ? (
            <AppText variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={styles.error}>
              {failure}
            </AppText>
          ) : null}

          <ParkingButton
            label={copy.submit}
            tone="danger"
            icon="trash-outline"
            loading={busy}
            disabled={!understood || busy}
            onPress={() => void submit()}
            style={styles.submit}
          />
        </View>
      ) : (
        <Notice
          tone="info"
          title={copy.guestTitle}
          style={styles.form}
          actions={<ParkingButton label={copy.signIn} compact onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })} />}
        >
          {copy.guestBody}
        </Notice>
      )}
    </InnerScreenFrame>
  );
}
