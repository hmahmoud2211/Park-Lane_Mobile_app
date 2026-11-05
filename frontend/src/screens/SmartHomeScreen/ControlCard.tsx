import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { ControlCardInfo } from './SmartHomeScreen.data';

export interface ControlCardProps extends PropsWithChildren {
  info: ControlCardInfo;
  on: boolean;
  onToggle: (next: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

/** Drawn 19dp; a touch smaller so the title keeps its line in the half-width card. */
const ICON_SIZE = 18;
const INSET = 12;
const BOTTOM = 12;
/** A switched-off card keeps its controls visible but quiet, as a disabled form does. */
const OFF_OPACITY = 0.4;

/**
 * One of the Smart Home screen's half-width control cards (Lighting, AC,
 * Curtains, TV & Media): the inner screens' neon panel, headed by an icon,
 * title, supporting line and an on/off switch. Switching off dims and
 * disables the controls beneath.
 */
export function ControlCard({ info, on, onToggle, style, children }: ControlCardProps) {
  const theme = useAppTheme();

  return (
    <NeonPanel style={[styles.card, style]}>
      <PanelHeading
        title={info.title}
        subtitle={info.subtitle}
        icon={
          <AppIcon
            set={info.iconSet}
            name={info.iconName}
            size={ICON_SIZE}
            color={theme.colors[info.iconColor]}
          />
        }
        iconSize={ICON_SIZE}
        divider={false}
        trailing={
          <ToggleSwitch value={on} onValueChange={onToggle} accessibilityLabel={info.title} />
        }
      />
      <View
        style={[styles.body, !on && styles.off]}
        pointerEvents={on ? 'auto' : 'none'}
        accessibilityElementsHidden={!on}
        importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
      >
        {children}
      </View>
    </NeonPanel>
  );
}

const styles = StyleSheet.create({
  // Grows rather than flexes, so it fills a grid row yet sizes to content when stacked.
  card: {
    flexGrow: 1,
    paddingBottom: BOTTOM,
  },
  body: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: INSET,
  },
  off: {
    opacity: OFF_OPACITY,
  },
});
