import { useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { circleInviteMessage } from '../../features/circles/services/circleRules';
import type { CircleInvite, OpenCircleInvite } from '../../features/circles/types';
import { EmsError } from '../../features/ems/services/emsHttp';
import { inviteValidity } from '../../features/unit/services/unitRules';
import { useAppTheme } from '../../hooks/useAppTheme';
import { shareOutcomeMessage, shareText } from '../../utils/share';
import { circleCopy as copy } from './CircleScreen.data';
import { BUTTON_HEIGHT, SMALL_BUTTON_HEIGHT, type createStyles } from './CircleScreen.styles';

interface InvitePanelProps {
  circleName: string;
  open: OpenCircleInvite[];
  create: () => Promise<CircleInvite>;
  cancel: (inviteId: string) => Promise<void>;
  styles: ReturnType<typeof createStyles>;
}

const hoursLeft = (expiresAt: number) => {
  const validity = inviteValidity(expiresAt, Date.now());
  return validity?.unit === 'hours' ? validity.count : 0;
};

/**
 * An owner inviting someone: one tap makes a code and opens the share sheet with a message that says where to enter
 * it. The code stays on screen to share again, and codes nobody has used yet can be cancelled.
 */
export function InvitePanel({ circleName, open, create, cancel, styles }: InvitePanelProps) {
  const theme = useAppTheme();
  const [invite, setInvite] = useState<CircleInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const share = async (current: CircleInvite) =>
    setNote(shareOutcomeMessage(await shareText(copy.shareTitle, circleInviteMessage(circleName, current.code)), copy.shareWhat));

  const make = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await create();
      setInvite(next);
      await share(next);
    } catch (failure) {
      setError(failure instanceof EmsError ? failure.message : copy.inviteFailed);
    } finally {
      setBusy(false);
    }
  };

  const cancelOne = async (id: string) => {
    setCancelling(id);
    setError(null);
    try {
      await cancel(id);
      if (invite?.id === id) setInvite(null);
    } catch (failure) {
      setError(failure instanceof EmsError ? failure.message : copy.inviteFailed);
    } finally {
      setCancelling(null);
    }
  };

  return (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.inviteTitle} iconSet="ionicons" iconName="person-add-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.inviteBody}
      </AppText>
      {invite ? (
        <>
          <AppText variant="screenTitle" style={styles.code} selectable accessibilityLabel={invite.code.split('').join(' ')}>
            {invite.code}
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport} align="center">
            {copy.codeExpires(hoursLeft(invite.expiresAt))}
          </AppText>
          <View style={styles.row}>
            <AppButton title={copy.share} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void share(invite)} style={styles.action} />
          </View>
        </>
      ) : null}
      <AppButton title={copy.invite} variant="gradient" height={BUTTON_HEIGHT} loading={busy} onPress={() => void make()} />
      {open.length > 0 ? (
        <>
          <AppText variant="bodyStrong">{copy.openInvites}</AppText>
          {open.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.text}>
                <AppText variant="tileCaption" color={theme.colors.textSupport}>
                  {copy.codeExpires(hoursLeft(item.expiresAt))}
                </AppText>
              </View>
              <AppButton
                title={copy.cancelInvite}
                variant="secondary"
                height={SMALL_BUTTON_HEIGHT}
                loading={cancelling === item.id}
                onPress={() => void cancelOne(item.id)}
                style={styles.action}
              />
            </View>
          ))}
        </>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {note ? <Notice tone="info">{note}</Notice> : null}
    </NeonPanel>
  );
}
