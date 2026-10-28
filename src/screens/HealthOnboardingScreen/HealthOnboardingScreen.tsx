import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ErrorNotice } from '../../components/health/LoadState';
import { CheckRow, InfoRow } from '../../components/parking/Controls';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { isHealthError, type HealthError } from '../../services/health/healthService';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { dataUsePoints, onboardingCopy } from './HealthOnboardingScreen.data';
import { createStyles } from './HealthOnboardingScreen.styles';

/**
 * The first visit to Health Passport: what is kept, who reads it, and an
 * explicit agreement. The feature stays locked until consent is recorded on
 * the backend.
 */
export function HealthOnboardingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'HealthOnboarding'>['navigation']>();
  const { lang, setConsent } = useHealth();
  const copy = onboardingCopy[lang];
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HealthError | null>(null);

  const agree = async () => {
    setBusy(true);
    setError(null);
    try {
      await setConsent(true);
      navigation.replace('HealthPassport');
    } catch (caught) {
      if (isHealthError(caught)) setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <HealthFrame
      title={copy.title}
      subtitle={copy.subtitle}
      bottomBar={false}
      sideNav
      footer={
        <View style={styles.footer}>
          <ParkingButton
            tone="primary"
            icon="shield-checkmark-outline"
            label={copy.agree}
            disabled={!agreed}
            loading={busy}
            onPress={() => void agree()}
          />
          <ParkingButton label={copy.notNow} onPress={() => navigation.goBack()} disabled={busy} />
        </View>
      }
    >
      <Panel icon="medkit-outline" title={copy.title}>
        <AppText variant="body" style={styles.muted}>
          {copy.intro}
        </AppText>
      </Panel>
      <Panel title={copy.howTitle}>
        <View style={styles.points}>
          {dataUsePoints[lang].map((point) => (
            <InfoRow key={point.title} icon={point.icon} label={point.title} value={<AppText variant="caption">{point.body}</AppText>} />
          ))}
        </View>
      </Panel>
      <Panel>
        <View style={styles.consent}>
          <CheckRow label={copy.consentLabel} detail={copy.consentDetail} checked={agreed} onChange={setAgreed} />
        </View>
      </Panel>
      {error ? <ErrorNotice error={error} onRetry={() => void agree()} /> : null}
    </HealthFrame>
  );
}
