import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';

/**
 * A brand's mark in the device lists. Brand logos are trademarks and the
 * gateway sends only a key, so each brand gets a neutral monogram; unknown
 * brands get a question mark.
 */
const MONOGRAMS: Record<string, string> = {
  lg: 'LG',
  samsung: 'SA',
  sonoff: 'SO',
  tuya: 'TU',
  tplink: 'TP',
  xiaomi: 'MI',
  shelly: 'SH',
  wiz: 'WZ',
  lifx: 'LX',
  wled: 'WL',
  daikin: 'DK',
  midea: 'MD',
};

const SIZE = 40;
const ICON_SIZE = 20;

export function BrandBadge({ logo, name }: { logo: string; name: string }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const monogram = MONOGRAMS[logo] ?? (logo === 'other' ? null : name.slice(0, 2).toUpperCase());

  return (
    <View style={styles.badge} accessible={false}>
      {monogram ? (
        <AppText variant="statValue" numberOfLines={1}>
          {monogram}
        </AppText>
      ) : (
        <AppIcon set="ionicons" name="help-outline" size={ICON_SIZE} />
      )}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    badge: {
      width: SIZE,
      height: SIZE,
      borderRadius: theme.borderRadius.sm,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.avatarStroke,
      backgroundColor: theme.colors.avatarFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
