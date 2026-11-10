import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';

import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
// Visitor Access's form sizes, so the app's forms read as one.
import { FIELD_CHEVRON_SIZE, FIELD_HEIGHT, FORM_ICON_SIZE } from '../../components/forms/formMetrics';
import {
  communityCopy as copy,
  feedbackTopics,
  validateFeedback,
  type FeedbackErrors,
  type FeedbackForm as FeedbackValues,
} from './CommunityScreen.data';
import { FormSubmitButton } from '../../components/forms/FormSubmitButton';

export interface FeedbackFormProps {
  /** Sends a message that passed the app's checks; resolves with what went wrong, if anything. */
  onSubmit: (feedback: FeedbackValues) => Promise<string | null>;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}

/* The layout of Maintenance's request form, itself Visitor Access's. */
const FORM_INSET = 12;
const FORM_TOP = 14;
const FORM_BOTTOM = 14;
const HEADER_TO_FIELDS = 14;
const FIELD_GAP = 10;
const CTA_TOP = 16;
const CLOSE_ICON_SIZE = 16;
/** Room for about three lines of message. */
const MESSAGE_HEIGHT = 74;
const MESSAGE_LINES_HEIGHT = 44;
const MAX_MESSAGE = 500;

/** "Share Feedback": a topic and a message for management. */
export function FeedbackForm({ onSubmit, onClose, style }: FeedbackFormProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [form, setForm] = useState<FeedbackValues>({ topic: '', message: '' });
  const [errors, setErrors] = useState<FeedbackErrors>({});
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const topicRef = useRef<ViewInstance>(null);

  const update = (key: keyof FeedbackValues, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const openTopics = () => {
    Keyboard.dismiss();
    topicRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  };

  const submit = () => {
    Keyboard.dismiss();
    const found = validateFeedback(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    if (busy) return;
    setBusy(true);
    setFailure(null);
    onSubmit({ topic: form.topic, message: form.message.trim() })
      .then(setFailure)
      .finally(() => setBusy(false));
  };

  const topicItems: readonly AppMenuItem[] = feedbackTopics.map((topic) => ({
    id: topic,
    label: topic,
    onPress: () => {
      update('topic', topic);
      setAnchor(null);
    },
  }));

  return (
    <NeonPanel style={[styles.panel, style]}>
      <View style={styles.header}>
        <Ionicons name="chatbubbles-outline" size={FORM_ICON_SIZE} color={theme.colors.textPrimary} />
        <View style={styles.title}>
          <AppText variant="sectionTitle" accessibilityRole="header">
            {copy.feedbackFormTitle}
          </AppText>
          <AppText variant="statLabel" color={theme.colors.textSupport} style={styles.subtitle}>
            {copy.feedbackFormSubtitle}
          </AppText>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={copy.feedbackClose}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="close" size={CLOSE_ICON_SIZE} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.fields}>
        <Pressable
          ref={topicRef}
          onPress={openTopics}
          accessibilityRole="button"
          accessibilityLabel={`${copy.feedbackTopicLabel}: ${form.topic || copy.feedbackTopicPlaceholder}`}
          accessibilityHint="Opens a list of choices"
          style={({ pressed }) => pressed && styles.pressed}
        >
          {/* Display only: the whole field is the button, not the input. */}
          <View pointerEvents="none">
            <AppInput
              variant="field"
              height={FIELD_HEIGHT}
              label={copy.feedbackTopicLabel}
              value={form.topic}
              onChangeText={() => undefined}
              placeholder={copy.feedbackTopicPlaceholder}
              editable={false}
              leftIcon={<Ionicons name="pricetag-outline" size={15} color={theme.colors.textPrimary} />}
              rightIcon={
                <Ionicons name="chevron-down" size={FIELD_CHEVRON_SIZE} color={theme.colors.textPrimary} />
              }
              error={errors.topic}
            />
          </View>
        </Pressable>

        <AppInput
          variant="field"
          height={MESSAGE_HEIGHT}
          label={copy.feedbackMessageLabel}
          value={form.message}
          onChangeText={(text) => update('message', text)}
          placeholder={copy.feedbackMessagePlaceholder}
          leftIcon={<Ionicons name="create-outline" size={15} color={theme.colors.textPrimary} />}
          error={errors.message}
          multiline
          maxLength={MAX_MESSAGE}
          autoCapitalize="sentences"
          accessibilityLabel={copy.feedbackMessageLabel}
          inputStyle={styles.message}
        />
      </View>

      <FormSubmitButton title={busy ? copy.feedbackSending : copy.feedbackSend} onPress={submit} style={styles.cta} />
      {failure ? (
        <AppText variant="statLabel" color={theme.colors.error} accessibilityRole="alert" style={styles.failure}>
          {failure}
        </AppText>
      ) : null}

      <AppMenu
        visible={anchor !== null}
        onClose={() => setAnchor(null)}
        items={topicItems}
        anchor={anchor ?? undefined}
        align="left"
        selectedId={form.topic || undefined}
      />
    </NeonPanel>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    panel: {
      paddingHorizontal: FORM_INSET,
      paddingTop: FORM_TOP,
      paddingBottom: FORM_BOTTOM,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: HEADER_TO_FIELDS,
      paddingLeft: 4,
      paddingRight: 2,
    },
    title: {
      flex: 1,
      marginLeft: 10,
      marginRight: theme.spacing.sm,
    },
    subtitle: {
      marginTop: 1.5,
    },
    fields: {
      gap: FIELD_GAP,
    },
    // Three lines, starting at the top as a message field should.
    message: {
      height: MESSAGE_LINES_HEIGHT,
      textAlignVertical: 'top',
    },
    cta: {
      marginTop: CTA_TOP,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
      ...theme.shadows.glow,
    },
    failure: {
      marginTop: theme.spacing.sm,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
