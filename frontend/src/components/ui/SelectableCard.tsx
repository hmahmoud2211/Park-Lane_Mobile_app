import type { ReactNode } from 'react';
import { Pressable, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { GlassSurface } from '../common/GlassSurface';

export interface SelectableCardProps {
  onPress?: () => void;
  disabled?: boolean;
  /** Draws the glow, for the option the resident picked. */
  selected?: boolean;
  accessibilityLabel: string;
  accessibilityState?: AccessibilityState;
  /** Applied while pressed; each screen keeps its own measured feedback. */
  pressedStyle?: StyleProp<ViewStyle>;
  /** Applied while disabled, e.g. dimmed. */
  disabledStyle?: StyleProp<ViewStyle>;
  /** The card's own style: padding, gaps. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * A choice in a list (a brand, a way to add a device, a device that was found): a glass
 * card with the home tiles' cyan-to-violet stroke over the subtle fill, unblurred so long
 * lists stay light, glowing when selected.
 */
export function SelectableCard({
  onPress,
  disabled,
  selected,
  accessibilityLabel,
  accessibilityState,
  pressedStyle,
  disabledStyle,
  style,
  children,
}: SelectableCardProps) {
  const theme = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [pressed && pressedStyle, disabled && disabledStyle]}
    >
      <GlassSurface
        radius={theme.borderRadius.sm}
        blurred={false}
        glow={selected}
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={style}
      >
        {children}
      </GlassSurface>
    </Pressable>
  );
}
