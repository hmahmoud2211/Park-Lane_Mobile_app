import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Notice } from '../../components/feedback/Notice';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { LinkCard } from '../../components/ui/LinkCard';
import { ParkingButton } from '../../components/ui/ParkingButton';
import { useEms } from '../../features/ems/hooks/useEms';
import { emsErrorText } from '../../features/ems/services/emsHttp';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { accountActions, accountSecurityCopy as copy, type AccountActionId } from './AccountSecurityScreen.data';
import { createStyles } from './AccountSecurityScreen.styles';

type Result = { tone: 'success' | 'error'; text: string } | null;

/**
 * The signed-in account: changing the password, signing out other phones (a lost phone), and
 * deleting the account (App Store 5.1.1(v), Google Play), from Settings. A guest is asked to sign in.
 */
export function AccountSecurityScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'AccountSecurity'>['navigation']>();
  const { status, user, signOutOthers } = useEms();
  const [confirmingOthers, setConfirmingOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const signedIn = status === 'signedIn' && user;

  const open = (id: AccountActionId) => {
    setResult(null);
    if (id === 'password') {
      navigation.navigate('ChangePassword', { voluntary: true });
    } else if (id === 'others') {
      setConfirmingOthers(true);
    } else {
      navigation.navigate('DeleteAccount');
    }
  };

  const endOthers = async () => {
    setBusy(true);
    try {
      setResult({ tone: 'success', text: copy.othersDone(await signOutOthers()) });
    } catch (error) {
      setResult({ tone: 'error', text: emsErrorText(error) });
    } finally {
      setBusy(false);
      setConfirmingOthers(false);
    }
  };

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader
        title={copy.title}
        subtitle={signedIn ? copy.subtitle(user.email) : copy.guestSubtitle}
        style={styles.header}
      />

      {signedIn ? (
        <View style={styles.list}>
          {accountActions.map((action) => (
            <LinkCard
              key={action.id}
              size="compact"
              title={action.title}
              description={action.description}
              icon={{ set: action.iconSet, name: action.iconName }}
              onPress={() => open(action.id)}
            />
          ))}
        </View>
      ) : (
        <Notice
          tone="info"
          title={copy.guestTitle}
          actions={<ParkingButton label={copy.signIn} compact onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })} />}
        >
          {copy.guestBody}
        </Notice>
      )}

      {confirmingOthers ? (
        <Notice
          tone="warning"
          title={copy.confirmOthersTitle}
          style={styles.notice}
          actions={
            <View style={styles.actions}>
              <ParkingButton label={copy.confirmOthers} tone="danger" compact loading={busy} onPress={() => void endOthers()} />
              <ParkingButton label={copy.cancel} tone="secondary" compact disabled={busy} onPress={() => setConfirmingOthers(false)} />
            </View>
          }
        >
          {copy.confirmOthersBody}
        </Notice>
      ) : null}

      {result ? (
        <Notice tone={result.tone} style={styles.notice}>
          {result.text}
        </Notice>
      ) : null}
    </InnerScreenFrame>
  );
}
