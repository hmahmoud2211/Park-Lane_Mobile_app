import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import type { IconSet } from '../../components/ui/ServiceTile';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface AutomationRowProps {
  title: string;
  summary: string;
  iconSet: IconSet;
  iconName: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  onPress: () => void;
}

/*
 * Measured on the Smart Home reference (assets/Screens/screen10.png): drawn
 * 32dp tall, taller here for the roomier rhythm and a comfortable target.
 */
const MIN_HEIGHT = 42;
const ICON_BOX = 24;
const ICON_SIZE = 18;
const INSET_LEFT = 10;
const ICON_TO_TEXT = 12;
const CHEVRON_SIZE = 12;
const INSET_RIGHT = 9;

/** One routine in the Smart Home "Device Automation" panel. Laid on the panel's glass. */
export function AutomationRow({
  title,
  summary,
  iconSet,
  iconName,
  enabled,
  onToggle,
  onPress,
}: AutomationRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${summary}`}
      accessibilityHint="Shows the automation"
      style={({ pressed }) => pressed && styles.pressed}
    >
      <GlassSurface
        radius={theme.borderRadius.sm}
        stroke="gradient"
        strokeColors={[theme.colors.avatarStroke, theme.colors.dividerSubtle]}
        blurred={false}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.surface}
      >
        <View style={styles.icon}>
          <AppIcon set={iconSet} name={iconName} size={ICON_SIZE} />
        </View>
        <View style={styles.text}>
          <AppText variant="statValue" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={2}>
            {summary}
          </AppText>
        </View>
        <ToggleSwitch value={enabled} onValueChange={onToggle} accessibilityLabel={title} />
        <Ionicons
          name="chevron-forward"
          size={CHEVRON_SIZE}
          color={theme.colors.textPrimary}
          style={styles.chevron}
        />
      </GlassSurface>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: INSET_LEFT,
      paddingRight: INSET_RIGHT,
      paddingVertical: theme.spacing.xs + 2,
    },
    icon: {
      width: ICON_BOX,
      alignItems: 'center',
    },
    text: {
      flex: 1,
      marginLeft: ICON_TO_TEXT,
      marginRight: theme.spacing.sm,
      gap: 2,
    },
    chevron: {
      marginLeft: theme.spacing.md,
    },
    pressed: {
      opacity: 0.8,
    },
  });
}
