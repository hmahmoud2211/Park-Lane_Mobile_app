import { useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { EmsError } from '../../features/ems/services/emsHttp';
import { inviteMessage, openInviteLabel } from '../../features/unit/services/unitRules';
import type { OpenUnitInvite, UnitInvite, UnitRole } from '../../features/unit/types';
import { useAppTheme } from '../../hooks/useAppTheme';
import { copyText, shareOutcomeMessage, shareText } from '../../utils/share';
import { householdCopy as copy } from './HouseholdScreen.data';
import { BUTTON_HEIGHT, QR_SIZE, SMALL_BUTTON_HEIGHT, type createStyles } from './HouseholdScreen.styles';

interface InvitePanelProps {
  open: OpenUnitInvite[] | null;
  create: (role: UnitRole) => Promise<UnitInvite>;
  cancel: (id: string) => Promise<void>;
  styles: ReturnType<typeof createStyles>;
}

/**
 * An owner inviting family: one tap makes the invite and opens the phone's share sheet with a
 * message that leads with the link. The code (and a QR code of the link, for someone standing
 * next to them) stays on screen to share again or copy, and invites nobody has used yet can be
 * cancelled.
 */
export function InvitePanel({ open, create, cancel, styles }: InvitePanelProps) {
  const theme = useAppTheme();
  const [invite, setInvite] = useState<UnitInvite | null>(null);
  const [busy, setBusy] = useState<UnitRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const share = async (current: UnitInvite) => {
    const message = inviteMessage(current);
    if (!message) {
      setNote(copy.inviteExpired);
      return;
    }
    setNote(shareOutcomeMessage(await shareText(copy.shareTitle, message), copy.shareWhat));
  };

  const make = async (role: UnitRole) => {
    if (busy) return;
    setBusy(role);
    setError(null);
    setNote(null);
    try {
      const next = await create(role);
      setInvite(next);
      await share(next);
    } catch (failure) {
      setError(failure instanceof EmsError ? failure.message : copy.inviteFailed);
    } finally {
      setBusy(null);
    }
  };

  const copyMessage = async (current: UnitInvite) => {
    const message = inviteMessage(current);
    if (!message) {
      setNote(copy.inviteExpired);
      return;
    }
    setNote((await copyText(message)) ? copy.copied : copy.copyFailed);
  };

  const cancelOne = async (id: string) => {
    setCancelling(id);
    setError(null);
    try {
      await cancel(id);
      if (invite?.id === id) setInvite(null);
    } catch (failure) {
      setError(failure instanceof EmsError ? failure.message : copy.cancelFailed);
    } finally {
      setCancelling(null);
    }
  };

  // The invite on screen shows its own Cancel; the list holds the others.
  const waiting = (open ?? []).filter((entry) => entry.id !== invite?.id);

  return (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.inviteTitle} iconSet="ionicons" iconName="person-add-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.inviteBody}
      </AppText>

      {invite ? (
        <GlassSurface
          radius={theme.borderRadius.sm}
          blurred={false}
          glow
          strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
          fillOpacity={theme.glass.subtleFillOpacity}
          style={styles.item}
        >
          <AppText variant="figure" align="center" selectable accessibilityLabel={copy.codeSpoken(invite.code)} accessibilityLiveRegion="polite">
            {invite.code}
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport} align="center">
            {openInviteLabel(invite.role, invite.expiresAt)}
          </AppText>
          <View style={styles.qrFrame} accessible accessibilityRole="image" accessibilityLabel={copy.qrLabel}>
            <QRCode value={invite.link ?? invite.code} size={QR_SIZE} ecl="M" color={theme.colors.deepNavy} backgroundColor={theme.colors.white} />
          </View>
          <AppText variant="tileCaption" color={theme.colors.textSupport} align="center">
            {copy.qrHint}
          </AppText>
          <View style={styles.row}>
            <AppButton title={copy.shareAgain} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void share(invite)} style={styles.action} />
            <AppButton title={copy.copy} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void copyMessage(invite)} style={styles.action} />
          </View>
          <AppButton
            title={copy.cancelInvite}
            variant="secondary"
            height={SMALL_BUTTON_HEIGHT}
            loading={cancelling === invite.id}
            onPress={() => void cancelOne(invite.id)}
          />
        </GlassSurface>
      ) : null}
      {note ? (
        <AppText variant="tileCaption" color={theme.colors.textSupport} align="center" accessibilityLiveRegion="polite">
          {note}
        </AppText>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <AppButton title={copy.invite} variant={invite ? 'secondary' : 'gradient'} height={BUTTON_HEIGHT} loading={busy === 'member'} disabled={busy === 'owner'} onPress={() => void make('member')} />
      <AppButton
        title={copy.inviteOwner}
        variant="secondary"
        height={SMALL_BUTTON_HEIGHT}
        loading={busy === 'owner'}
        disabled={busy === 'member'}
        onPress={() => void make('owner')}
        accessibilityHint={copy.inviteOwnerHint}
      />

      {waiting.length > 0 ? (
        <>
          <View style={styles.divider} />
          <AppText variant="statValue">{copy.waitingTitle}</AppText>
          {waiting.map((entry) => (
            <View key={entry.id} style={styles.itemRow}>
              <View style={styles.text}>
                <AppText variant="bodySmall">{openInviteLabel(entry.role, entry.expiresAt)}</AppText>
                {entry.invitedBy ? (
                  <AppText variant="tileCaption" color={theme.colors.textSupport}>
                    {copy.waitingBy(entry.invitedBy)}
                  </AppText>
                ) : null}
              </View>
              <AppButton
                title={copy.cancelInvite}
                variant="secondary"
                height={SMALL_BUTTON_HEIGHT}
                loading={cancelling === entry.id}
                onPress={() => void cancelOne(entry.id)}
                style={styles.action}
              />
            </View>
          ))}
        </>
      ) : null}
    </NeonPanel>
  );
}
