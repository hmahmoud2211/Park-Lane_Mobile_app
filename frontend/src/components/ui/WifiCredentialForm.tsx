import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type TextInputInstance, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppInput } from '../common/AppInput';
import { AppText } from '../common/AppText';

export interface WifiCredentialFormProps {
  ssid: string;
  password: string;
  onChangeSsid: (value: string) => void;
  onChangePassword: (value: string) => void;
  errors?: { ssid?: string; password?: string };
  editable?: boolean;
  onSubmit?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Visitor Access's compact field height, as on the Add Device sheet. */
const FIELD_HEIGHT = 44;
const ICON_SIZE = 17;
const EYE_SIZE = 18;

/** WPA2 passphrases are 8 to 63 characters; open networks have none. */
export function validateWifiCredentials(ssid: string, password: string): { ssid?: string; password?: string } {
  const errors: { ssid?: string; password?: string } = {};
  if (!ssid.trim()) {
    errors.ssid = 'Enter your Wi-Fi network’s name.';
  } else if (new TextEncoder().encode(ssid).length > 32) {
    errors.ssid = 'Wi-Fi network names are at most 32 bytes.';
  }
  if (password.length > 0 && (password.length < 8 || password.length > 63)) {
    errors.password = 'Wi-Fi passwords are 8 to 63 characters.';
  }
  return errors;
}

/**
 * Home Wi-Fi name and password, with a show/hide control. The password lives
 * only in the parent's state: autofill and password saving are switched off,
 * so the OS does not offer to keep it either.
 */
export function WifiCredentialForm({
  ssid,
  password,
  onChangeSsid,
  onChangePassword,
  errors,
  editable = true,
  onSubmit,
  style,
}: WifiCredentialFormProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [revealed, setRevealed] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  return (
    <View style={style}>
      <AppInput
        variant="field"
        height={FIELD_HEIGHT}
        label="Wi-Fi name (SSID)"
        placeholder="e.g. Parklane-Home"
        value={ssid}
        onChangeText={onChangeSsid}
        error={errors?.ssid}
        editable={editable}
        leftIcon={<Ionicons name="wifi-outline" size={ICON_SIZE} color={theme.colors.textPrimary} />}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <AppInput
        ref={passwordRef}
        variant="field"
        height={FIELD_HEIGHT}
        label="Wi-Fi password"
        placeholder="Leave empty for an open network"
        value={password}
        onChangeText={onChangePassword}
        error={errors?.password}
        editable={editable}
        secureTextEntry={!revealed}
        leftIcon={<Ionicons name="lock-closed-outline" size={ICON_SIZE} color={theme.colors.textPrimary} />}
        rightIcon={
          <Pressable
            onPress={() => setRevealed((current) => !current)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={EYE_SIZE}
              color={theme.colors.textSupport}
            />
          </Pressable>
        }
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        containerStyle={styles.field}
      />
      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={ICON_SIZE} color={theme.colors.textSupport} />
        <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.noteText}>
          SONOFF plugs join 2.4 GHz networks only. If your router uses one name for both bands, make sure 2.4
          GHz is on.
        </AppText>
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    field: {
      marginTop: theme.spacing.sm,
    },
    note: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginTop: theme.spacing.sm + 2,
      gap: theme.spacing.sm - 2,
    },
    noteText: {
      flex: 1,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
