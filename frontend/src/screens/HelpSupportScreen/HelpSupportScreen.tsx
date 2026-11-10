import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';
import { Linking } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { LinkCard } from '../../components/ui/LinkCard';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { legal } from '../../config/legal';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { helpSupportCopy as copy } from './HelpSupportScreen.data';
import { createStyles } from './HelpSupportScreen.styles';

/**
 * How to get help (App Store 1.5: an easy way to reach the developer), how a forgotten password
 * is reset, what the health features are not (medical-app disclaimers), the privacy policy and
 * the way to account settings. The Contact Us tab, Services and Settings open it.
 */
export function HelpSupportScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'HelpSupport'>['navigation']>();

  const panel = (heading: string, body: string) => (
    <NeonPanel style={styles.panel}>
      <AppText variant="bodyStrong" accessibilityRole="header" style={styles.heading}>
        {heading}
      </AppText>
      <AppText variant="bodySmall" color={theme.colors.textSecondary}>
        {body}
      </AppText>
    </NeonPanel>
  );

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />

      {panel(copy.contactHeading, copy.contactBody)}
      {legal.supportEmail ? (
        <LinkCard
          size="compact"
          title={copy.emailTitle}
          description={copy.emailDescription(legal.supportEmail)}
          icon={{ set: 'ionicons', name: 'mail-outline' }}
          onPress={() => void Linking.openURL(`mailto:${legal.supportEmail}`)}
        />
      ) : null}
      {panel(copy.passwordHeading, copy.passwordBody)}
      {legal.privacyPolicyUrl ? (
        <LinkCard
          size="compact"
          title={copy.privacyTitle}
          description={copy.privacyDescription}
          icon={{ set: 'ionicons', name: 'shield-checkmark-outline' }}
          onPress={() => void WebBrowser.openBrowserAsync(legal.privacyPolicyUrl as string)}
        />
      ) : null}
      <LinkCard
        size="compact"
        title={copy.accountTitle}
        description={copy.accountDescription}
        icon={{ set: 'ionicons', name: 'person-circle-outline' }}
        onPress={() => navigation.navigate('AccountSecurity')}
      />
      {panel(copy.healthHeading, copy.healthBody)}
    </InnerScreenFrame>
  );
}
