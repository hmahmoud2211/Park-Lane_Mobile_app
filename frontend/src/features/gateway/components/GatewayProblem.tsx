import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '../../../components/common/AppButton';
import { ErrorNotice } from '../../../components/feedback/ErrorNotice';
import { LoadingState } from '../../../components/feedback/LoadingState';
import { Notice } from '../../../components/feedback/Notice';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { layout } from '../../../theme';
import type { RootStackParamList } from '../../../types/navigation.types';
import type { AppTheme } from '../../../types/theme.types';
import { useGateway } from '../hooks/useGateway';
import { NoGatewayNotice } from './NoGatewayNotice';

const copy = {
  connecting: 'Connecting to your gateway',
  accountConnecting: 'Connecting to your home hub…',
  accountFailedTitle: 'Could not connect to your home hub',
  noHub: 'Your apartment doesn’t have a home hub yet. Building management can set one up.',
  noGatewayTitle: 'Connect your CUBE Gateway first',
  noGatewayBody:
    'Devices are found and controlled by the CUBE Gateway running on a computer in your home. Connect this phone to it once, then add devices here.',
  connectGateway: 'Connect gateway',
  offlineTitle: 'Your gateway is not reachable',
  unauthorizedTitle: 'Your gateway no longer accepts this phone',
  retry: 'Try again',
  manageGateway: 'Home hub settings',
} as const;

const BUTTON_HEIGHT = layout.innerScreen.buttonHeight;

/**
 * Why the gateway can't be used right now, and the way on, for the Add Device screens: a spinner
 * while it (or the connection through the resident's account) is connecting, Try again when it
 * did not answer, and a way to connect one when the phone has none. Nothing while it is online.
 */
export function GatewayProblem() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const gateway = useGateway();
  const { account } = gateway;

  if (gateway.status === 'online') {
    return null;
  }
  if (gateway.status === 'loading' || gateway.status === 'connecting') {
    return <LoadingState accessibilityLabel={copy.connecting} />;
  }
  if (gateway.status === 'none') {
    if (account.state === 'connecting') {
      return <LoadingState label={copy.accountConnecting} labelVariant="bodySmall" announce />;
    }
    if (account.state === 'error') {
      return (
        <ErrorNotice title={copy.accountFailedTitle} retryLabel={copy.retry} onRetry={() => void gateway.connectAccount()}>
          {account.message}
        </ErrorNotice>
      );
    }
    if (account.state === 'no_gateway') {
      return <Notice tone="info">{copy.noHub}</Notice>;
    }
    return <NoGatewayNotice title={copy.noGatewayTitle} body={copy.noGatewayBody} actionLabel={copy.connectGateway} />;
  }
  return (
    <Notice
      tone={gateway.status === 'unauthorized' ? 'error' : 'warning'}
      title={gateway.status === 'unauthorized' ? copy.unauthorizedTitle : copy.offlineTitle}
      actions={
        <View style={styles.actions}>
          {gateway.status === 'offline' ? (
            <AppButton title={copy.retry} variant="secondary" height={BUTTON_HEIGHT} onPress={() => void gateway.reconnect()} style={styles.action} />
          ) : null}
          <AppButton title={copy.manageGateway} variant="secondary" height={BUTTON_HEIGHT} onPress={() => navigation.navigate('GatewaySetup')} style={styles.action} />
        </View>
      }
    >
      {gateway.problem}
    </Notice>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    action: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.md,
    },
  });
}
