// Imported by subpath: the package root re-exports every icon set, which
// bundles ~2.5MB of unused .ttf fonts.
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextInput,
} from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { BackButton } from '../../components/common/BackButton';
import { GlassSurface } from '../../components/common/GlassSurface';
import { GradientText } from '../../components/common/GradientText';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { ArrowRightIcon } from '../../components/ui/ArrowRightIcon';
import { GoogleMark } from '../../components/ui/GoogleMark';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import {
  loginCopy,
  signInMethods,
  validateLogin,
  type LoginErrors,
  type SignInMethodId,
} from './LoginScreen.data';
import {
  BACK_BUTTON_SIZE,
  FIELD_HEIGHT,
  SUBMIT_HEIGHT,
  createStyles,
} from './LoginScreen.styles';

const FIELD_ICON_SIZE = 17;

function MethodIcon({ id, theme }: { id: SignInMethodId; theme: AppTheme }) {
  const color = theme.colors.textPrimary;

  switch (id) {
    case 'face-id':
      return <MaterialCommunityIcons name="face-recognition" size={23} color={color} />;
    case 'fingerprint':
      return <MaterialCommunityIcons name="fingerprint" size={23} color={color} />;
    case 'google':
      return <GoogleMark size={21} />;
  }
}

export function LoginScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [notice, setNotice] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);

  const handleSubmit = useCallback(() => {
    const nextErrors = validateLogin(email, password);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setNotice(null);
      return;
    }

    // Frontend only: no authentication service is wired up behind this yet.
    setNotice('Details look valid. Sign-in is not connected to a backend yet.');
  }, [email, password]);

  const togglePassword = useCallback(() => setShowPassword((shown) => !shown), []);

  return (
    <ScreenWrapper backgroundSource={images.loginBackground} withScrim={false} withGutter>
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
              source={images.brandWordmark}
              style={styles.lockup}
              resizeMode="contain"
              accessibilityLabel="Park Lane Compoundhood, New Capital"
            />
          </View>

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
              label={loginCopy.emailLabel}
              value={email}
              onChangeText={setEmail}
              height={FIELD_HEIGHT}
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
              label={loginCopy.passwordLabel}
              value={password}
              onChangeText={setPassword}
              height={FIELD_HEIGHT}
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
              height={SUBMIT_HEIGHT}
              labelVariant="buttonSoft"
              trailingIcon={<ArrowRightIcon size={14} />}
              style={styles.submit}
            />

            {notice ? (
              <AppText
                variant="caption"
                color={theme.colors.textSecondary}
                align="center"
                style={styles.notice}
              >
                {notice}
              </AppText>
            ) : null}
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
                onPress={() => {
                  // TODO(auth): wire to the real provider once one exists.
                }}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}
