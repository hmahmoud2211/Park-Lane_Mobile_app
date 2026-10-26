import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { EmsAccountPanel } from '../../components/ems/EmsAccountPanel';
import { timeAgo } from '../../components/ems/SmartDeviceCard';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/parking/Notice';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { images } from '../../constants/images';
import { useAlexaIntegration } from '../../hooks/useAlexaIntegration';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useEmsDevices } from '../../hooks/useEmsDevices';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { alexaCopy as copy, statusDisplay, voiceExamples } from './AlexaIntegrationScreen.data';
import { BUTTON_HEIGHT, SMALL_BUTTON_HEIGHT, createStyles } from './AlexaIntegrationScreen.styles';

/**
 * Connects the EMS account to the "EMS Voice Control" Alexa skill and
 * chooses which devices it may switch. The connection status is the
 * backend's, which only reports "Connected" once Amazon confirmed the skill
 * is enabled and the account linked.
 */
export function AlexaIntegrationScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'AlexaIntegration'>['navigation']>();
  const ems = useEmsDevices();
  const alexa = useAlexaIntegration();
  const { status: link } = alexa;

  const display = link ? statusDisplay[link.status] : null;
  const linked = link?.status === 'linked';

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.content, layout.contentStyle]} showsVerticalScrollIndicator={false}>
          <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />

          {ems.status !== 'signedIn' ? (
            <EmsAccountPanel intro={copy.accountIntro} />
          ) : (
            <>
              <NeonPanel style={styles.panel}>
                <PanelHeading
                  title={copy.connectionTitle}
                  iconSet="ionicons"
                  iconName="mic-outline"
                  subtitle={copy.connectionBody}
                  divider
                />

                {!link ? (
                  <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel="Checking Alexa status" />
                ) : (
                  <>
                    <View style={styles.statusRow} accessibilityLiveRegion="polite">
                      {display ? <StatusChip label={display.label} tone={display.tone} icon={display.icon} glow={linked} /> : null}
                      {alexa.loading ? <ActivityIndicator size="small" color={theme.colors.textAccentSoft} /> : null}
                    </View>
                    <View style={styles.details}>
                      {linked ? (
                        <AppText variant="tileCaption" color={theme.colors.textSupport}>
                          {link.via === 'alexa'
                            ? 'Linked from the Alexa app or website.'
                            : `Linked from this app${link.linkedAt ? ` ${timeAgo(link.linkedAt)}` : ''}.`}
                        </AppText>
                      ) : null}
                      {link.lastCheckedAt ? (
                        <AppText variant="tileCaption" color={theme.colors.textSupport}>
                          Last confirmed with Amazon {timeAgo(link.lastCheckedAt)}
                        </AppText>
                      ) : null}
                      {link.lastError && !alexa.notice ? (
                        <AppText variant="tileCaption" color={linked ? theme.colors.textSupport : theme.colors.error}>
                          {link.lastError}
                        </AppText>
                      ) : null}
                    </View>

                    {!link.configured ? <Notice tone="warning">{copy.notConfigured}</Notice> : null}
                    {alexa.notice ? <Notice tone={alexa.notice.tone}>{alexa.notice.message}</Notice> : null}

                    <View style={styles.buttons}>
                      {linked ? (
                        <AppButton
                          title={copy.disconnect}
                          variant="secondary"
                          height={BUTTON_HEIGHT}
                          loading={alexa.busy === 'disconnect'}
                          disabled={alexa.busy !== null}
                          onPress={() => void alexa.disconnect()}
                        />
                      ) : (
                        <AppButton
                          title={link.status === 'unlinked' ? copy.connect : copy.reconnect}
                          variant="gradient"
                          height={BUTTON_HEIGHT}
                          loading={alexa.busy === 'connect'}
                          disabled={alexa.busy !== null || !link.configured}
                          onPress={() => void alexa.connect()}
                        />
                      )}
                      <AppButton
                        title={copy.check}
                        variant="secondary"
                        height={SMALL_BUTTON_HEIGHT}
                        loading={alexa.busy === 'check'}
                        disabled={alexa.busy !== null}
                        onPress={() => void alexa.check()}
                      />
                    </View>
                    <AppText variant="tileCaption" color={theme.colors.textSupport}>
                      {copy.customSkillNote}
                    </AppText>
                  </>
                )}
              </NeonPanel>

              <NeonPanel style={styles.panel}>
                <PanelHeading
                  title={copy.accessTitle}
                  iconSet="ionicons"
                  iconName="shield-checkmark-outline"
                  subtitle={copy.accessBody}
                  actionLabel={copy.manageDevices}
                  onActionPress={() => navigation.navigate('EmsDevices')}
                  divider
                />
                {!ems.devicesLoaded ? (
                  <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel="Loading devices" />
                ) : ems.devices.length === 0 ? (
                  <AppText variant="bodySmall" color={theme.colors.textSupport}>
                    {copy.noDevices}
                  </AppText>
                ) : (
                  ems.devices.map((device) => (
                    <View key={device.id} style={styles.accessRow}>
                      <View style={styles.accessText}>
                        <AppText variant="statValue" numberOfLines={1}>
                          {device.name}
                        </AppText>
                        <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={1}>
                          {[device.room, device.simulated ? 'Virtual' : null, device.online ? 'Online' : 'Offline']
                            .filter(Boolean)
                            .join(' · ')}
                        </AppText>
                        {ems.errors[device.id] ? (
                          <AppText variant="tileCaption" color={theme.colors.error} accessibilityRole="alert">
                            {ems.errors[device.id]}
                          </AppText>
                        ) : null}
                      </View>
                      <FilterChip
                        role="radio"
                        label={device.isDefault ? copy.defaultLabel : copy.setDefault}
                        iconSet="ionicons"
                        iconName={device.isDefault ? 'star' : 'star-outline'}
                        selected={device.isDefault}
                        onPress={() => {
                          if (!device.isDefault) void ems.update(device, { isDefault: true });
                        }}
                      />
                      <ToggleSwitch
                        value={device.alexaEnabled}
                        onValueChange={(allowed) => void ems.update(device, { alexaEnabled: allowed })}
                        disabled={ems.busy[device.id] === 'edit'}
                        accessibilityLabel={`Alexa may control ${device.name}`}
                      />
                    </View>
                  ))
                )}
              </NeonPanel>

              <NeonPanel style={styles.panel}>
                <PanelHeading title={copy.commandsTitle} iconSet="ionicons" iconName="chatbubbles-outline" divider />
                <View style={styles.examples}>
                  {voiceExamples.map((example) => (
                    <View key={example.id} style={styles.example}>
                      <AppText variant="statLabel" color={theme.colors.textAccentSoft}>
                        {example.language}
                      </AppText>
                      {example.lines.map((line) => (
                        <AppText key={line} variant="bodySmall" style={example.id === 'ar' ? styles.rtl : undefined}>
                          {line}
                        </AppText>
                      ))}
                    </View>
                  ))}
                </View>
              </NeonPanel>

              <NeonPanel style={styles.panel}>
                <PanelHeading title={copy.troubleshootingTitle} iconSet="ionicons" iconName="help-buoy-outline" divider />
                {copy.troubleshooting.map((tip) => (
                  <View key={tip} style={styles.tip}>
                    <AppText variant="bodySmall" color={theme.colors.textSupport}>
                      •
                    </AppText>
                    <AppText variant="bodySmall" color={theme.colors.textSupport} style={styles.flex}>
                      {tip}
                    </AppText>
                  </View>
                ))}
              </NeonPanel>

              <EmsAccountPanel intro={copy.accountIntro} />
            </>
          )}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
