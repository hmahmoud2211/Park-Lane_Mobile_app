// Imported by subpath: the package root re-exports every icon set, which
// bundles ~2.5MB of unused .ttf fonts.
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextInput,
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
import { assistantConfig } from '../../constants/assistantConfig';
import { images } from '../../constants/images';
import { useAppContext } from '../../hooks/useAppContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { AppTheme } from '../../types/theme.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  loginCopy,
  signInMethods,
  validateLogin,
  type LoginErrors,
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

export function LoginScreen() {
  const theme = useAppTheme();
  const { isWide } = useScreenLayout();
  const styles = useMemo(() => createStyles(theme, isWide), [theme, isWide]);
  const navigation = useNavigation<RootStackScreenProps<'Login'>['navigation']>();
  // Tablets and desktops get roomier controls, sized for a pointer or a finger at arm's length.
  const fieldHeight = isWide ? FIELD_HEIGHT_WIDE : FIELD_HEIGHT;
  const submitHeight = isWide ? SUBMIT_HEIGHT_WIDE : SUBMIT_HEIGHT;
  const { setResidentId } = useAppContext();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});

  const passwordRef = useRef<TextInput>(null);

  const handleSubmit = useCallback(() => {
    const nextErrors = validateLogin(email, password);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    // Frontend only: nothing is authenticated here. `replace` rather than
    // `navigate` so the back gesture does not return to the login form.
    // TODO(auth): verify credentials before routing once a backend exists.
    setResidentId(assistantConfig.defaultResidentId);
    navigation.replace('Home');
  }, [email, password, navigation, setResidentId]);

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
        // TODO(auth): wire to the device's biometric prompt once sign-in exists.
        return;
    }
  };

  const togglePassword = useCallback(() => setShowPassword((shown) => !shown), []);

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
              accessibilityLabel="Park Lane Compoundhood, New Capital"
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
              {loginCopy.subtitle}
            </AppText>

            <View style={styles.form}>
              <AppInput
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
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
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

              <Pressable
                onPress={() => {
                  // TODO(nav): route to password recovery once that screen exists.
                }}
                style={styles.forgotPassword}
                accessibilityRole="button"
              >
                <AppText variant="bodySmall" color={theme.colors.link}>
                  {loginCopy.forgotPassword}
                </AppText>
              </Pressable>

              <AppButton
                title={loginCopy.submit}
                onPress={handleSubmit}
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
