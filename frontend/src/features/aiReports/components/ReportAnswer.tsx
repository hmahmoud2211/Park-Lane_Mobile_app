import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { AiReportReason, AiReportSource } from '../../../../../shared/contracts/aiReports';
import { AppText } from '../../../components/common/AppText';
import { DirectionView, type LayoutDirection } from '../../../components/common/DirectionView';
import { Notice } from '../../../components/feedback/Notice';
import { Field } from '../../../components/ui/Controls';
import { ParkingButton } from '../../../components/ui/ParkingButton';
import { SelectableCard } from '../../../components/ui/SelectableCard';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { layout } from '../../../theme';
import type { AppTheme } from '../../../types/theme.types';
import { useAiReport } from '../hooks/useAiReport';
import { MAX_REPORT_NOTE } from '../services/aiReportsApi';
import type { ReportCopy } from '../types';

/** The words in English; Health Passport passes its own English and Arabic. */
export const reportCopyEn: ReportCopy = {
  button: 'Report',
  buttonA11y: 'Report this answer',
  sentButton: 'Reported',
  title: 'Report this answer',
  body: 'Tell us what is wrong with it. We will read your report. It includes this answer.',
  reasons: {
    offensive: 'Offensive or hurtful',
    harmful: 'Could cause harm',
    wrong: 'Wrong information',
    other: 'Something else',
  },
  noteLabel: 'Anything to add? (optional)',
  notePlaceholder: 'What was wrong?',
  send: 'Send',
  cancel: 'Cancel',
  thanks: 'Thanks. We’ll look at this answer.',
  done: 'Done',
  tryAgain: 'Try again',
  errors: {
    network: 'We couldn’t send it. Check your internet connection and try again.',
    busy: 'You’ve sent many reports just now. Wait a little and try again.',
    unavailable: 'This version of the app can’t send reports.',
    other: 'Something went wrong. Please try again.',
  },
};

const REASONS: readonly AiReportReason[] = ['offensive', 'harmful', 'wrong', 'other'];

export interface ReportAnswerProps {
  /** Where the answer was shown. */
  source: AiReportSource;
  /** The AI's text being reported (cut to the backend's limit when sent). */
  excerpt: string;
  copy?: ReportCopy;
  /** For an Arabic page. Omitted, it follows the screen. */
  direction?: LayoutDirection;
  style?: StyleProp<ViewStyle>;
}

/**
 * A small "Report" button under an AI answer, as Google Play's AI-Generated Content policy asks: it opens a sheet
 * where anyone, signed in or a guest, says what is wrong (four plain reasons and an optional note) and sends it to
 * building management without leaving the app. Once sent, the button says so and is not offered again.
 */
export function ReportAnswer({ source, excerpt, copy = reportCopyEn, direction, style }: ReportAnswerProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);

  if (!excerpt.trim()) return null;

  return (
    <DirectionView direction={direction} style={[styles.buttonRow, style]}>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={reported}
        accessibilityRole="button"
        accessibilityLabel={reported ? copy.sentButton : copy.buttonA11y}
        accessibilityState={{ disabled: reported }}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Ionicons
          name={reported ? 'checkmark-circle-outline' : 'flag-outline'}
          size={14}
          color={reported ? theme.colors.success : theme.colors.textSupport}
        />
        <AppText variant="label" color={reported ? theme.colors.success : theme.colors.textSupport}>
          {reported ? copy.sentButton : copy.button}
        </AppText>
      </Pressable>
      {open ? (
        <ReportSheet
          source={source}
          excerpt={excerpt}
          copy={copy}
          direction={direction}
          onSent={() => setReported(true)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </DirectionView>
  );
}

interface ReportSheetProps {
  source: AiReportSource;
  excerpt: string;
  copy: ReportCopy;
  direction?: LayoutDirection;
  onSent: () => void;
  onClose: () => void;
}

/** Mounted only while open, so each opening starts clean. */
function ReportSheet({ source, excerpt, copy, direction, onSent, onClose }: ReportSheetProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { phase, failure, send, sending } = useAiReport(source);
  const [reason, setReason] = useState<AiReportReason | null>(null);
  const [note, setNote] = useState('');

  const submit = async () => {
    if (!reason || sending) return;
    if (await send(reason, note, excerpt)) onSent();
  };
  const close = () => {
    if (!sending) onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {/* Not accessible elements themselves, or VoiceOver can't reach the controls inside. */}
        <Pressable style={styles.backdrop} onPress={close} accessible={false} onAccessibilityEscape={close}>
          <Pressable style={styles.panelWrap} onPress={(event) => event.stopPropagation()} accessible={false}>
            {/* A plain tinted panel, as ConfirmSheet: the glass choices inside frost the backdrop themselves. */}
            <View style={styles.panel}>
              <DirectionView direction={direction}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                  <AppText variant="subheading" accessibilityRole="header">
                    {copy.title}
                  </AppText>
                  {phase === 'sent' ? (
                    <>
                      <Notice tone="success" title={copy.thanks} />
                      <ParkingButton tone="primary" label={copy.done} onPress={onClose} />
                    </>
                  ) : (
                    <>
                      <AppText variant="caption" color={theme.colors.textSecondary}>
                        {copy.body}
                      </AppText>
                      <View style={styles.reasons} accessibilityRole="radiogroup">
                        {REASONS.map((value) => {
                          const selected = reason === value;
                          return (
                            <SelectableCard
                              key={value}
                              selected={selected}
                              disabled={sending}
                              onPress={() => setReason(value)}
                              accessibilityLabel={copy.reasons[value]}
                              accessibilityState={{ selected, disabled: sending }}
                              pressedStyle={styles.pressed}
                              style={styles.reason}
                            >
                              <Ionicons
                                name={selected ? 'radio-button-on' : 'radio-button-off'}
                                size={20}
                                color={selected ? theme.colors.accent : theme.colors.textSupport}
                              />
                              <AppText variant="bodyStrong" style={styles.reasonLabel}>
                                {copy.reasons[value]}
                              </AppText>
                            </SelectableCard>
                          );
                        })}
                      </View>
                      <Field
                        label={copy.noteLabel}
                        placeholder={copy.notePlaceholder}
                        value={note}
                        onChangeText={setNote}
                        maxLength={MAX_REPORT_NOTE}
                        multiline
                        editable={!sending}
                        hint={`${note.length} / ${MAX_REPORT_NOTE}`}
                      />
                      {phase === 'failed' && failure ? (
                        <Notice
                          tone="error"
                          actions={<ParkingButton compact icon="refresh" label={copy.tryAgain} onPress={() => void submit()} />}
                        >
                          {copy.errors[failure]}
                        </Notice>
                      ) : null}
                      <View style={styles.actions}>
                        <ParkingButton
                          tone="primary"
                          icon="send"
                          label={copy.send}
                          loading={sending}
                          disabled={!reason || sending}
                          onPress={() => void submit()}
                        />
                        <ParkingButton label={copy.cancel} onPress={close} disabled={sending} />
                      </View>
                    </>
                  )}
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
  const target = layout.aiReport;
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    buttonRow: {
      flexDirection: 'row',
    },
    button: {
      minHeight: target.minTarget,
      minWidth: target.minTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
    },
    pressed: {
      opacity: 0.6,
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
      maxWidth: target.sheetMaxWidth,
      maxHeight: '100%',
      alignSelf: 'center',
    },
    panel: {
      maxHeight: '100%',
      overflow: 'hidden',
      borderRadius: theme.borderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.bubbleStroke,
      backgroundColor: theme.colors.cameraFill,
      ...theme.shadows.card,
    },
    content: {
      padding: theme.spacing.md,
      gap: theme.spacing.md,
    },
    reasons: {
      gap: theme.spacing.sm,
    },
    reason: {
      minHeight: target.reasonMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    reasonLabel: {
      flex: 1,
    },
    actions: {
      gap: theme.spacing.sm,
    },
  });
}
