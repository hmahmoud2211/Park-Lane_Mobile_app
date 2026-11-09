import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useLayoutSize } from '../../hooks/useLayoutSize';
import type { GlyphReading } from './BmsScreen.data';
import { PUMP_ICON_SIZE, WAVE_HEIGHT, createStyles, toneColor } from './BmsScreen.styles';
import { BmsTile } from './BmsTile';

export interface PumpTileProps {
  pump: GlyphReading;
  scale: number;
}

/** A gentle wave across a `width` by `height` box: a trough, a crest, a trough. */
function wavePath(width: number, height: number) {
  const mid = height / 2;
  const q = width / 4;
  return `M 0 ${mid} C ${q * 0.5} ${height} ${q * 1.5} ${height} ${q * 2} ${mid} S ${q * 3.5} 0 ${width} ${mid}`;
}

/** One pump: its glyph, name and state, over the faint wave the reference draws along the bottom. */
export function PumpTile({ pump, scale }: PumpTileProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, scale), [theme, scale]);
  const { ref, size, onLayout } = useLayoutSize(true);

  return (
    <BmsTile style={styles.pumpTile}>
      <View
        ref={ref}
        onLayout={onLayout}
        style={styles.wave}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {size.width > 0 ? (
          <Svg width={size.width} height={WAVE_HEIGHT}>
            <Path d={wavePath(size.width, WAVE_HEIGHT)} stroke={theme.colors.infoStroke} strokeWidth={1.2} fill="none" />
          </Svg>
        ) : null}
      </View>
      <View accessible accessibilityLabel={`${pump.name}, ${pump.status}`} style={styles.centred}>
        <AppIcon set={pump.iconSet} name={pump.iconName} size={PUMP_ICON_SIZE} />
        <AppText variant="statValue" numberOfLines={1} style={styles.pumpName}>
          {pump.name}
        </AppText>
        <AppText variant="statValue" color={toneColor(theme, pump.tone)} style={styles.pumpStatus}>
          {pump.status}
        </AppText>
      </View>
    </BmsTile>
  );
}
