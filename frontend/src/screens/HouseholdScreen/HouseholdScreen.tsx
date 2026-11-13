import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { useEms } from '../../features/ems/hooks/useEms';
import { useUnit } from '../../features/unit/hooks/useUnit';
import { useUnitInvites } from '../../features/unit/hooks/useUnitInvites';
import { keepInviteForSignIn } from '../../features/unit/services/pendingInvite';
import { codeFromText, formatCodeInput, isCodeComplete } from '../../features/unit/services/unitRules';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { householdCopy as copy } from './HouseholdScreen.data';
import { BUTTON_HEIGHT, SMALL_BUTTON_HEIGHT, createStyles } from './HouseholdScreen.styles';
import { InvitePanel } from './InvitePanel';
import { JoinPanel } from './JoinPanel';
import { MembersPanel } from './MembersPanel';

/** The code a route param carries, cleaned up, or null: links may hand over a code, a link or a loosely typed one. */
function linkedCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const code = codeFromText(raw) ?? formatCodeInput(raw);
  return isCodeComplete(code) ? code : null;
}

/**
 * Who shares the resident's home, and the one place for family invites: an owner invites with
 * one tap (share sheet, link, code and QR code); someone invited opens the link, or pastes,
 * scans or types the code, sees which apartment it is and joins with one more tap. Opened from
 * Settings, My Unit, the gateway screen, and invite links (parklane://join/<code>), which also
 * work before signing in: the code waits while they sign in (features/unit/services/pendingInvite).
 */
export function HouseholdScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Household'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'Household'>['route']>();
  const code = linkedCode(params?.code);
  const ems = useEms();
  const unit = useUnit();
  const mine = unit.state.status === 'ready' ? unit.state.unit : null;
  const owner = mine?.role === 'owner';
  const invites = useUnitInvites(owner);
  const [joined, setJoined] = useState<string | null>(null);

  const signIn = () => {
    if (code) keepInviteForSignIn(code);
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const renderSignedOut = () => (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={code ? copy.invitedTitle : copy.signInTitle} iconSet="ionicons" iconName={code ? 'mail-open-outline' : 'log-in-outline'} divider />
      {ems.status === 'loading' ? (
        <LoadingState label={copy.checkingSession} />
      ) : (
        <>
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {code ? copy.invitedBody : copy.signInBody}
          </AppText>
          <AppButton title={copy.signIn} variant="gradient" height={BUTTON_HEIGHT} onPress={signIn} />
        </>
      )}
    </NeonPanel>
  );

  const ownerNames = (mine?.members ?? [])
    .filter((member) => member.role === 'owner' && !member.you)
    .map((member) => member.name)
    .join(' or ');

  const renderBody = () => {
    if (ems.status !== 'signedIn' || ems.passwordChangeRequired) return renderSignedOut();
    const { state } = unit;
    switch (state.status) {
      case 'loading':
        return <LoadingState label={copy.loading} />;
      case 'error':
        return (
          <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={unit.reload} buttonHeight={SMALL_BUTTON_HEIGHT} tone="warning">
            {state.message}
          </ErrorNotice>
        );
      case 'hidden':
        return (
          <Notice tone="info" title={copy.unavailableTitle}>
            {copy.unavailableBody}
          </Notice>
        );
      case 'none':
        return <JoinPanel key={code ?? 'typed'} initialCode={code} inUnit={false} check={unit.check} join={unit.join} onJoined={setJoined} styles={styles} />;
      case 'ready':
        return (
          <>
            {code && !joined ? (
              <JoinPanel key={code} initialCode={code} inUnit check={unit.check} join={unit.join} onJoined={setJoined} styles={styles} />
            ) : null}
            <MembersPanel unit={state.unit} removeMember={unit.removeMember} styles={styles} />
            {owner ? (
              <InvitePanel open={invites.open} create={invites.create} cancel={invites.cancel} styles={styles} />
            ) : (
              <Notice tone="info">{copy.memberOnly(ownerNames)}</Notice>
            )}
          </>
        );
    }
  };

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />
      {joined ? (
        <Notice
          tone="success"
          actions={<AppButton title={copy.openSmartHome} variant="gradient" height={BUTTON_HEIGHT} onPress={() => navigation.navigate('SmartHome')} />}
        >
          {copy.joined(joined)}
        </Notice>
      ) : null}
      {renderBody()}
    </InnerScreenFrame>
  );
}
