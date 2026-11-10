// Imported by subpath: the package root re-exports every icon set, which
// bundles ~2.5MB of unused .ttf fonts.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View, type TextInputInstance } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { BackButton } from '../../components/common/BackButton';
import { GradientText } from '../../components/common/GradientText';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { ArrowRightIcon } from '../../components/ui/ArrowRightIcon';
import { assistantConfig } from '../../config/assistant';
import { brand } from '../../config/brand';
import { images } from '../../constants/images';
import { useEms } from '../../features/ems/hooks/useEms';
import { EmsError, emsErrorText } from '../../features/ems/services/emsHttp';
import { hasProblems, passwordChangeFailure, passwordProblems } from '../../features/ems/services/passwordChange';
import { useAppContext } from '../../hooks/useAppContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useLogout } from '../../hooks/useScreenMenu';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { changePasswordCopy, failureText, problemText, voluntaryPasswordCopy } from './ChangePasswordScreen.data';
import {
  BACKGROUND_ASPECT,
  BACKGROUND_OVERLAY_WIDE,
  FIELD_HEIGHT,
  FIELD_HEIGHT_WIDE,
  FIELD_ICON_SIZE,
  SUBMIT_HEIGHT,
  SUBMIT_HEIGHT_WIDE,
  createStyles,
} from './ChangePasswordScreen.styles';

/**
 * Choosing one's own password after signing in with a temporary one (an account building
 * management created, or reset). It comes before anything else: Login sends a resident here,
 * and AppNavigator brings them back whenever a call is refused for it. Once the password is
 * set the app opens exactly as after any sign-in, on the same session.
 *
 * With `voluntary` (from Account & security) it changes a password the resident chose before:
 * there is a way back, and saving returns to where they came from.
 */
export function ChangePasswordScreen() {
  const theme = useAppTheme();
  const { isWide } = useScreenLayout();
  const styles = useMemo(() => createStyles(theme, isWide), [theme, isWide]);
  const navigation = useNavigation<RootStackScreenProps<'ChangePassword'>['navigation']>();
  const voluntary = useRoute<RootStackScreenProps<'ChangePassword'>['route']>().params?.voluntary === true;
  const copy = voluntary ? voluntaryPasswordCopy : changePasswordCopy;
  const { setResidentId } = useAppContext();
  const { status, user, passwordChangeRequired, changePassword } = useEms();
  const logout = useLogout();
  const fieldHeight = isWide ? FIELD_HEIGHT_WIDE : FIELD_HEIGHT;
  const submitHeight = isWide ? SUBMIT_HEIGHT_WIDE : SUBMIT_HEIGHT;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false);
  const [problems, setProblems] = useState<ReturnType<typeof problemText>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);

  // Done (or never needed, or signed out meanwhile): on as a sign-in goes, with nothing to go back to.
  useEffect(() => {
    if (status === 'signedOut') {
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } else if (!voluntary && status === 'signedIn' && !passwordChangeRequired) {
      setResidentId(assistantConfig.defaultResidentId);
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    }
  }, [status, passwordChangeRequired, navigation, setResidentId, voluntary]);

  const submit = async () => {
    const found = passwordProblems({ current, next, confirm, email: user?.email ?? null });
    setProblems(problemText(found, voluntary));
    setFailure(null);
    if (hasProblems(found)) {
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      if (voluntary) {
        navigation.goBack();
      }
    } catch (error) {
      setFailure(failureText(passwordChangeFailure(error instanceof EmsError ? error.code : null), emsErrorText(error)));
      setBusy(false);
    }
  };

  const eye = (
    <Pressable onPress={() => setShown((value) => !value)} hitSlop={10} accessibilityRole="button" accessibilityLabel={shown ? copy.hide : copy.show}>
      <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={FIELD_ICON_SIZE} color={theme.colors.textPrimary} />
    </Pressable>
  );
  const lock = <Ionicons name="lock-closed-outline" size={FIELD_ICON_SIZE} color={theme.colors.textPrimary} />;

  return (
    <ScreenWrapper
      backgroundSource={images.loginBackground}
      backgroundBottomAnchorAspect={isWide ? BACKGROUND_ASPECT : undefined}
      backgroundOverlay={isWide ? BACKGROUND_OVERLAY_WIDE : undefined}
      withScrim={false}
      withGutter
    >
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {voluntary ? <BackButton style={styles.back} /> : null}
          <Image fadeDuration={0} source={images.brandWordmark} style={styles.lockup} resizeMode="contain" accessibilityLabel={brand.wordmarkLabel} />

          <View style={styles.card}>
            <View style={styles.heading}>
              <AppText variant="heading" accessibilityRole="header">
                {copy.headingLead}
              </AppText>
              <GradientText variant="heading">{copy.headingAccent}</GradientText>
            </View>
            <AppText variant="bodySmall" color={theme.colors.textAccentSoft} style={styles.subtitle}>
              {copy.intro}
            </AppText>

            <View style={styles.form}>
              {user?.email ? (
                <AppText variant="bodySmall" color={theme.colors.textSupport} style={styles.signedInAs}>
                  {copy.signedInAs(user.email)}
                </AppText>
              ) : null}
              <AppInput
                placeholder={copy.currentLabel}
                accessibilityLabel={copy.currentLabel}
                value={current}
                onChangeText={setCurrent}
                height={fieldHeight}
                error={problems.current}
                secureTextEntry={!shown}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="next"
                onSubmitEditing={() => nextRef.current?.focus()}
                leftIcon={lock}
                rightIcon={eye}
              />
              <AppInput
                ref={nextRef}
                placeholder={copy.nextLabel}
                accessibilityLabel={copy.nextLabel}
                value={next}
                onChangeText={setNext}
                height={fieldHeight}
                error={problems.next}
                secureTextEntry={!shown}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
                containerStyle={styles.fieldGap}
                leftIcon={lock}
              />
              <AppInput
                ref={confirmRef}
                placeholder={copy.confirmLabel}
                accessibilityLabel={copy.confirmLabel}
                value={confirm}
                onChangeText={setConfirm}
                height={fieldHeight}
                error={problems.confirm}
                secureTextEntry={!shown}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                containerStyle={styles.fieldGap}
                leftIcon={lock}
              />
              <AppText variant="bodySmall" color={theme.colors.textSupport} style={styles.rules}>
                {copy.rules}
              </AppText>

              {failure ? (
                <AppText variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={styles.formError}>
                  {failure}
                </AppText>
              ) : null}

              <AppButton
                title={copy.submit}
                onPress={() => void submit()}
                loading={busy}
                height={submitHeight}
                labelVariant="buttonSoft"
                trailingIcon={<ArrowRightIcon size={14} />}
                style={styles.submit}
              />

              {voluntary ? null : (
                <Pressable onPress={logout} style={styles.link} accessibilityRole="button">
                  <AppText variant="bodySmall" color={theme.colors.link}>
                    {copy.signOut}
                  </AppText>
                </Pressable>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}
