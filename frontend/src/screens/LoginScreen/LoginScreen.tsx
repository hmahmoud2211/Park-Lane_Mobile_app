// Imported by subpath: the package root re-exports every icon set, which
// bundles ~2.5MB of unused .ttf fonts.
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextInputInstance,
  type ViewStyle,
} from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { BackButton } from '../../components/common/BackButton';
import { GlassSurface } from '../../components/common/GlassSurface';
import { GradientText } from '../../components/common/GradientText';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { ArrowRightIcon } from '../../components/ui/ArrowRightIcon';
import { assistantConfig } from '../../config/assistant';
import { legal } from '../../config/legal';
import { images } from '../../constants/images';
import { useEms } from '../../features/ems/hooks/useEms';
import { emsErrorText } from '../../features/ems/services/emsHttp';
import { useAppContext } from '../../hooks/useAppContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { AppTheme } from '../../types/theme.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  accountCopy,
  loginCopy,
  signInMethods,
  validateLogin,
  validateNewAccount,
  type LoginErrors,
  type LoginMode,
  type SignInMethodId,
} from './LoginScreen.data';
import {
  BACKGROUND_ASPECT,
  BACKGROUND_OVERLAY_WIDE,
  BACK_BUTTON_SIZE,
  FIELD_HEIGHT,
  FIELD_HEIGHT_WIDE,
  SUBMIT_HEIGHT,
  SUBMIT_HEIGHT_WIDE,
  createStyles,
} from './LoginScreen.styles';
import { brand } from '../../config/brand';

const FIELD_ICON_SIZE = 17;

function MethodIcon({ id, theme }: { id: SignInMethodId; theme: AppTheme }) {
  const color = theme.colors.textPrimary;

  switch (id) {
    case 'biometric':
      return <MaterialCommunityIcons name="fingerprint" size={23} color={color} />;
    case 'guest':
      return <MaterialCommunityIcons name="account-arrow-right-outline" size={23} color={color} />;
  }
}

interface FormCardProps {
  wide: boolean;
  style: ViewStyle;
  children: ReactNode;
}

/**
 * A plain tinted panel rather than a GlassSurface: the fields and buttons
 * frost the photo themselves, and inside a clipped glass card their blur
 * composites as square patches around the rounded corners.
 */
function FormCard({ wide, style, children }: FormCardProps) {
  return wide ? <View style={style}>{children}</View> : <>{children}</>;
}

/**
 * The app's one sign-in, against the EMS accounts every part of the app shares: smart home,
 * Health Passport and the clinic use the session it starts. A stored session skips the form,
 * and "Continue as Guest" opens the app without one.
 */
export function LoginScreen() {
  const theme = useAppTheme();
  const { isWide } = useScreenLayout();
  const styles = useMemo(() => createStyles(theme, isWide), [theme, isWide]);
  const navigation = useNavigation<RootStackScreenProps<'Login'>['navigation']>();
  // Tablets and desktops get roomier controls, sized for a pointer or a finger at arm's length.
  const fieldHeight = isWide ? FIELD_HEIGHT_WIDE : FIELD_HEIGHT;
  const submitHeight = isWide ? SUBMIT_HEIGHT_WIDE : SUBMIT_HEIGHT;
  const { setResidentId } = useAppContext();
  const { status, passwordChangeRequired, signIn, createAccount, sessionNotice } = useEms();

  const [mode, setMode] = useState<LoginMode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForgotHelp, setShowForgotHelp] = useState(false);

  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const creating = mode === 'create';

  // Signed in, just now or by a stored session. `replace` rather than `navigate`
  // so the back gesture does not return to the login form. A temporary password
  // is replaced first (ChangePasswordScreen), which then opens Home itself.
  useEffect(() => {
    if (status === 'signedIn') {
      setResidentId(assistantConfig.defaultResidentId);
      navigation.replace(passwordChangeRequired ? 'ChangePassword' : 'Home');
    }
  }, [status, passwordChangeRequired, navigation, setResidentId]);

  const handleSubmit = useCallback(async () => {
    const nextErrors = creating ? validateNewAccount(name, email, password) : validateLogin(email, password);
    setErrors(nextErrors);
    setFailure(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setBusy(true);
    try {
      if (creating) {
        await createAccount(name.trim(), email.trim(), password);
      } else {
        await signIn(email.trim(), password);
      }
    } catch (error) {
      setFailure(emsErrorText(error));
      setBusy(false);
    }
  }, [creating, name, email, password, signIn, createAccount]);

  const switchMode = useCallback(() => {
    setMode((current) => (current === 'signIn' ? 'create' : 'signIn'));
    setErrors({});
    setFailure(null);
    setShowForgotHelp(false);
  }, []);

  // Straight to Home with no resident, so the assistant answers as for a guest.
  const handleGuest = useCallback(() => {
    setResidentId(null);
    navigation.replace('Home');
  }, [navigation, setResidentId]);

  const handleMethod = (id: SignInMethodId) => {
    switch (id) {
      case 'guest':
        handleGuest();
        return;
      case 'biometric':
        // TODO(auth): wire to the device's biometric prompt.
        return;
    }
  };

  const togglePassword = useCallback(() => setShowPassword((shown) => !shown), []);

  const notice = failure ?? sessionNotice;

  return (
    <ScreenWrapper
      backgroundSource={images.loginBackground}
      backgroundBottomAnchorAspect={isWide ? BACKGROUND_ASPECT : undefined}
      backgroundOverlay={isWide ? BACKGROUND_OVERLAY_WIDE : undefined}
      withScrim={false}
      withGutter
    >
      <StatusBar style="light" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.lockupRow}>
            <BackButton size={BACK_BUTTON_SIZE} style={styles.backButton} />
            <Image
              fadeDuration={0}
              source={images.brandWordmark}
              style={styles.lockup}
              resizeMode="contain"
              accessibilityLabel={brand.wordmarkLabel}
            />
          </View>

          {/* Phones show the form on the photo; wider screens set it on a glass card. */}
          <FormCard wide={isWide} style={styles.card}>
            <View style={styles.heading}>
              <AppText variant="heading">{loginCopy.headingLead}</AppText>
              <View style={styles.headingGap} />
              <GradientText variant="heading">{loginCopy.headingAccent}</GradientText>
            </View>

            <AppText variant="bodySmall" color={theme.colors.textAccentSoft} style={styles.subtitle}>
              {creating ? accountCopy.subtitle : loginCopy.subtitle}
            </AppText>

            <View style={styles.form}>
              {creating ? (
                <AppInput
                  placeholder={accountCopy.nameLabel}
                  accessibilityLabel={accountCopy.nameLabel}
                  value={name}
                  onChangeText={setName}
                  height={fieldHeight}
                  error={errors.name}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  containerStyle={styles.nameField}
                  leftIcon={
                    <Ionicons
                      name="person-circle-outline"
                      size={FIELD_ICON_SIZE}
                      color={theme.colors.textPrimary}
                    />
                  }
                />
              ) : null}

              <AppInput
                ref={emailRef}
                placeholder={loginCopy.emailLabel}
                accessibilityLabel={loginCopy.emailLabel}
                value={email}
                onChangeText={setEmail}
                height={fieldHeight}
                error={errors.email}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                leftIcon={
                  <Ionicons
                    name="person-outline"
                    size={FIELD_ICON_SIZE}
                    color={theme.colors.textPrimary}
                  />
                }
              />

              <AppInput
                ref={passwordRef}
                placeholder={loginCopy.passwordLabel}
                accessibilityLabel={loginCopy.passwordLabel}
                value={password}
                onChangeText={setPassword}
                height={fieldHeight}
                error={errors.password}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={creating ? 'new-password' : 'password'}
                textContentType={creating ? 'newPassword' : 'password'}
                returnKeyType="go"
                onSubmitEditing={() => void handleSubmit()}
                containerStyle={styles.fieldGap}
                leftIcon={
                  <Ionicons
                    name="lock-closed-outline"
                    size={FIELD_ICON_SIZE}
                    color={theme.colors.textPrimary}
                  />
                }
                rightIcon={
                  <Pressable
                    onPress={togglePassword}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={FIELD_ICON_SIZE}
                      color={theme.colors.textPrimary}
                    />
                  </Pressable>
                }
              />

              <View style={styles.links}>
                <Pressable onPress={switchMode} style={styles.link} accessibilityRole="button">
                  <AppText variant="bodySmall" color={theme.colors.link}>
                    {creating ? accountCopy.signInLink : accountCopy.createLink}
                  </AppText>
                </Pressable>
                {creating ? null : (
                  <Pressable
                    onPress={() => setShowForgotHelp((shown) => !shown)}
                    style={styles.link}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showForgotHelp }}
                  >
                    <AppText variant="bodySmall" color={theme.colors.link}>
                      {loginCopy.forgotPassword}
                    </AppText>
                  </Pressable>
                )}
              </View>

              {showForgotHelp && !creating ? (
                <AppText variant="bodySmall" color={theme.colors.textAccentSoft} style={styles.formError}>
                  {loginCopy.forgotPasswordHelp}
                </AppText>
              ) : null}

              {notice ? (
                // A session that ended (or an account just deleted) is news, not a mistake.
                <AppText variant="bodySmall" color={failure ? theme.colors.error : theme.colors.textAccentSoft} accessibilityRole="alert" style={styles.formError}>
                  {notice}
                </AppText>
              ) : null}

              {creating && legal.privacyPolicyUrl ? (
                <AppText variant="bodySmall" color={theme.colors.textAccentSoft} style={styles.formError}>
                  {accountCopy.consentLead}
                  <AppText
                    variant="bodySmall"
                    color={theme.colors.textPrimary}
                    style={styles.inlineLink}
                    accessibilityRole="link"
                    onPress={() => void WebBrowser.openBrowserAsync(legal.privacyPolicyUrl as string)}
                  >
                    {accountCopy.privacyLink}
                  </AppText>
                  {accountCopy.consentEnd}
                </AppText>
              ) : null}

              <AppButton
                title={creating ? accountCopy.submit : loginCopy.submit}
                onPress={() => void handleSubmit()}
                loading={busy}
                height={submitHeight}
                labelVariant="buttonSoft"
                trailingIcon={<ArrowRightIcon size={14} />}
                style={styles.submit}
              />

            </View>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <AppText variant="bodySmall" style={styles.dividerLabel}>
                {loginCopy.divider}
              </AppText>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.methods}>
              {signInMethods.map((method, index) => (
                <Pressable
                  key={method.id}
                  onPress={() => handleMethod(method.id)}
                  accessibilityRole="button"
                  accessibilityLabel={method.label.split('\n').join(' ')}
                  style={index > 0 ? styles.methodGap : undefined}
                >
                  <GlassSurface radius={theme.borderRadius.lg} style={styles.methodCard}>
                    <MethodIcon id={method.id} theme={theme} />
                    <AppText variant="inputLabel" align="center" style={styles.methodLabel}>
                      {method.label}
                    </AppText>
                  </GlassSurface>
                </Pressable>
              ))}
            </View>
          </FormCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}
