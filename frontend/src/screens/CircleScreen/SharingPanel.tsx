import { useState } from 'react';
import { Platform, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import type { TurnOnResult } from '../../features/circles/hooks/useLocationSharing';
import type { Circle, LocationAccess } from '../../features/circles/types';
import { EmsError } from '../../features/ems/services/emsHttp';
import { useAppTheme } from '../../hooks/useAppTheme';
import { circleCopy as copy } from './CircleScreen.data';
import { SMALL_BUTTON_HEIGHT, type createStyles } from './CircleScreen.styles';

interface SharingPanelProps {
  circle: Circle;
  access: LocationAccess | null;
  busy: boolean;
  turnOn: (circleId: string) => Promise<TurnOnResult>;
  turnOff: (circleId: string) => Promise<void>;
  askAlways: () => Promise<void>;
  openSettings: () => Promise<unknown>;
  styles: ReturnType<typeof createStyles>;
}

/**
 * The person's own sharing in this Circle. Turning it on first explains what will happen (Google Play's "prominent
 * disclosure", required before the phone asks), then asks the phone. If the phone allows location only while the app
 * is open, or not at all, it says what to do about it.
 */
export function SharingPanel({ circle, access, busy, turnOn, turnOff, askAlways, openSettings, styles }: SharingPanelProps) {
  const theme = useAppTheme();
  const [disclosing, setDisclosing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const web = Platform.OS === 'web' || access === 'unsupported';

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof EmsError ? failure.message : copy.sharingFailed);
    }
  };

  const onSwitch = (next: boolean) => {
    if (!next) {
      setDisclosing(false);
      void run(() => turnOff(circle.id));
    } else if (access === 'always' || access === 'whileUsing') {
      // The phone already allows it: nothing new to explain.
      void run(async () => setDenied((await turnOn(circle.id)) === 'denied'));
    } else {
      setDisclosing(true);
    }
  };

  const proceed = () => {
    setDisclosing(false);
    void run(async () => setDenied((await turnOn(circle.id)) === 'denied'));
  };

  return (
    <NeonPanel style={styles.panel}>
      <PanelHeading
        title={copy.sharingTitle}
        iconSet="ionicons"
        iconName="navigate-circle-outline"
        divider
        trailing={
          web ? undefined : (
            <ToggleSwitch value={circle.sharing} onValueChange={onSwitch} disabled={busy} accessibilityLabel={copy.sharingSwitch} />
          )
        }
      />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {web ? copy.webNote : circle.sharing ? copy.sharingOn : copy.sharingOff}
      </AppText>

      {disclosing ? (
        <Notice
          tone="info"
          title={copy.disclosureTitle}
          actions={
            <>
              <AppButton title={copy.disclosureContinue} variant="gradient" height={SMALL_BUTTON_HEIGHT} onPress={proceed} />
              <AppButton title={copy.cancel} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => setDisclosing(false)} />
            </>
          }
        >
          {copy.disclosureBody}
        </Notice>
      ) : null}

      {!web && (denied || access === 'denied') && !circle.sharing ? (
        <Notice
          tone="warning"
          title={copy.deniedTitle}
          actions={<AppButton title={copy.openSettings} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void openSettings()} />}
        >
          {copy.deniedBody}
        </Notice>
      ) : null}

      {!web && circle.sharing && access === 'whileUsing' ? (
        <Notice
          tone="warning"
          title={copy.whileUsingTitle}
          actions={
            <View style={styles.row}>
              <AppButton title={copy.allowAlways} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void askAlways()} style={styles.action} />
              <AppButton title={copy.openSettings} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void openSettings()} style={styles.action} />
            </View>
          }
        >
          {copy.whileUsingBody}
        </Notice>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
    </NeonPanel>
  );
}
