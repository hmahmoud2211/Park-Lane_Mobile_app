import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { isHealthError, type HealthError } from '../../services/health/healthService';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { DirectionView } from '../common/DirectionView';
import { Field } from '../parking/Controls';
import { ParkingButton, type ParkingButtonTone } from '../parking/ParkingButton';
import { ErrorNotice } from './LoadState';

export interface ConfirmOption {
  id: string;
  label: string;
  tone?: ParkingButtonTone;
  icon?: keyof typeof Ionicons.glyphMap;
}

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body?: string;
  /** One button each, top to bottom; the sheet always adds Cancel. */
  options: readonly ConfirmOption[];
  /** Runs the chosen action; the sheet stays open, busy, until it settles, and shows any error. */
  onSelect: (id: string) => Promise<void> | void;
  onClose: () => void;
  /** A strong confirmation: the options stay disabled until this text is typed exactly. */
  typeToConfirm?: { expected: string; label: string };
  children?: ReactNode;
}

const PANEL_MAX_WIDTH = 440;

/**
 * Confirmation for anything that deletes or can't be undone. A sheet rather
 * than the system alert, which has no buttons on web, and which can't hold
 * a choice of three or a typed confirmation.
 */
export function ConfirmSheet(props: ConfirmSheetProps) {
  // Mounted only while open, so each opening starts clean.
  return props.visible ? <Sheet {...props} /> : null;
}

function Sheet({ title, body, options, onSelect, onClose, typeToConfirm, children }: ConfirmSheetProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { lang, t } = useHealth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<HealthError | null>(null);
  const [typed, setTyped] = useState('');

  const locked = typeToConfirm ? typed.trim() !== typeToConfirm.expected.trim() : false;

  const choose = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await onSelect(id);
    } catch (caught) {
      if (isHealthError(caught)) setError(caught);
      else throw caught;
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={t.actions.cancel}>
          <Pressable style={styles.panelWrap} onPress={(event) => event.stopPropagation()}>
            {/*
             * A plain tinted panel, not GlassSurface: the glass buttons inside
             * frost the backdrop themselves, and a blur nested in a blur
             * composites as square patches (as on the login form).
             */}
            <View style={styles.panel}>
              <DirectionView direction={lang === 'ar' ? 'rtl' : 'ltr'}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                  <AppText variant="subheading" accessibilityRole="header">
                    {title}
                  </AppText>
                  {body ? (
                    <AppText variant="caption" color={theme.colors.textSecondary}>
                      {body}
                    </AppText>
                  ) : null}
                  {children}
                  {typeToConfirm ? (
                    <Field
                      label={typeToConfirm.label}
                      value={typed}
                      onChangeText={setTyped}
                      placeholder={typeToConfirm.expected}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  ) : null}
                  {error ? <ErrorNotice error={error} /> : null}
                  <View style={styles.actions}>
                    {options.map((option) => (
                      <ParkingButton
                        key={option.id}
                        label={option.label}
                        tone={option.tone}
                        icon={option.icon}
                        loading={busy === option.id}
                        disabled={locked || (busy !== null && busy !== option.id)}
                        onPress={() => void choose(option.id)}
                      />
                    ))}
                    <ParkingButton label={t.actions.cancel} onPress={close} disabled={busy !== null} />
                  </View>
                </ScrollView>
              </DirectionView>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xxl,
      backgroundColor: theme.colors.scrimBottom,
    },
    panelWrap: {
      width: '100%',
      maxWidth: PANEL_MAX_WIDTH,
      maxHeight: '100%',
      alignSelf: 'center',
    },
    panel: {
      maxHeight: '100%',
      overflow: 'hidden',
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.bubbleStroke,
      backgroundColor: theme.colors.cameraFill,
      ...theme.shadows.card,
    },
    content: {
      padding: theme.spacing.md + 4,
      gap: 12,
    },
    actions: {
      gap: 8,
      marginTop: 4,
    },
  });
}
