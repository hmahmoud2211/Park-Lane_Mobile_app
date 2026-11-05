import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { AppButton } from '../../../components/common/AppButton';
import { Notice } from '../../../components/feedback/Notice';
import { layout } from '../../../theme';
import type { RootStackParamList } from '../../../types/navigation.types';

export interface NoGatewayNoticeProps {
  title: string;
  body: string;
  /** The button that opens gateway setup. */
  actionLabel: string;
}

/** No CUBE Gateway is paired with this phone yet: what that means here, and a way to connect one. */
export function NoGatewayNotice({ title, body, actionLabel }: NoGatewayNoticeProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Notice
      tone="info"
      title={title}
      actions={
        <AppButton title={actionLabel} variant="gradient" height={layout.innerScreen.buttonHeight} onPress={() => navigation.navigate('GatewaySetup')} />
      }
    >
      {body}
    </Notice>
  );
}
