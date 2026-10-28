import type { ComponentProps } from 'react';

import { useHealth } from '../../hooks/useHealth';
import { LanguageToggle } from '../parking/LanguageToggle';
import { ParkingFrame } from '../parking/ParkingFrame';

export type HealthFrameProps = Omit<ComponentProps<typeof ParkingFrame>, 'rtl' | 'headerTrailing'>;

/**
 * Health Passport's page: the inner screens' shell (see ParkingFrame), laid
 * out right-to-left in Arabic, with the language switch in the header, as
 * on the visitor pass.
 */
export function HealthFrame(props: HealthFrameProps) {
  const { lang, t, toggleLang } = useHealth();
  return (
    <ParkingFrame
      {...props}
      rtl={lang === 'ar'}
      headerTrailing={<LanguageToggle label={t.switchLabel} accessibilityLabel={t.switchA11y} onPress={toggleLang} />}
    />
  );
}
