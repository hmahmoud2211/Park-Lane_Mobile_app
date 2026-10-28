import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import type { ItemSummary } from '../../services/health/selectors';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { StatusChip, type StatusTone } from '../ui/StatusChip';
import { BidiText } from './BidiText';

export interface ItemRowProps {
  summary: ItemSummary;
  icon: keyof typeof Ionicons.glyphMap;
  /** "Added manually", or the document it came from. */
  sourceLabel?: string;
  onSourcePress?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  flag?: { label: string; tone: StatusTone };
  divided?: boolean;
  /** Drawn under the text, e.g. a lab trend. */
  footer?: ReactNode;
}

/**
 * One record item: its name as written, the figure that matters most drawn
 * large (a dose, a value, a date), where it came from, and edit and delete.
 */
export function ItemRow({ summary, icon, sourceLabel, onSourcePress, onEdit, onDelete, flag, divided, footer }: ItemRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useHealth();

  return (
    <View style={[styles.row, divided && styles.divided]}>
      <View style={styles.badge}>
        <Ionicons name={icon} size={18} color={theme.colors.textPrimary} />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <BidiText variant="bodyStrong">{summary.title}</BidiText>
          </View>
          {flag ? <StatusChip label={flag.label} tone={flag.tone} /> : null}
        </View>
        {summary.emphasis ? <BidiText variant="subheading">{summary.emphasis}</BidiText> : null}
        {summary.lines.map((line, index) => (
          <BidiText key={`${index}-${line}`} variant="label" color={theme.colors.textSupport}>
            {line}
          </BidiText>
        ))}
        {footer}
        {sourceLabel ? (
          <Pressable
            onPress={onSourcePress}
            disabled={!onSourcePress}
            accessibilityRole={onSourcePress ? 'link' : 'text'}
            hitSlop={8}
            style={({ pressed }) => [styles.source, pressed && styles.pressed]}
          >
            <Ionicons
              name={onSourcePress ? 'document-text-outline' : 'create-outline'}
              size={13}
              color={onSourcePress ? theme.colors.accent : theme.colors.textMuted}
            />
            <AppText variant="label" color={onSourcePress ? theme.colors.accent : theme.colors.textMuted}>
              {sourceLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {onEdit || onDelete ? (
        <View style={styles.actions}>
          {onEdit ? (
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel={`${t.actions.edit}: ${summary.title}`}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Ionicons name="create-outline" size={19} color={theme.colors.textPrimary} />
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={`${t.actions.delete}: ${summary.title}`}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={19} color={theme.colors.chipRedText} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 12,
      gap: 10,
    },
    divided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    badge: {
      width: 36,
      height: 36,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      flex: 1,
      gap: 3,
    },
    flex: {
      flex: 1,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    source: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 3,
      alignSelf: 'flex-start',
      minHeight: 24,
    },
    actions: {
      gap: 4,
    },
    action: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.borderRadius.sm,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
