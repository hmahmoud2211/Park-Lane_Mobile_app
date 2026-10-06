import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import {
  MEDIA_ROW_INSET_LEFT,
  MEDIA_ROW_LEADING_GAP,
  MediaRow,
} from '../../components/ui/MediaRow';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  announcements,
  communityAlerts,
  communityCopy as copy,
  currentPoll,
  dateParts,
  pollShares,
  rsvpDisplay,
  timeRange,
  upcomingEvents,
  type AlertLevel,
  type CommunityEvent,
  type RsvpStatus,
} from './CommunityScreen.data';
import {
  ALERT_BADGE_ICON_SIZE,
  ALERT_PHOTO,
  ANNOUNCEMENT_PHOTO,
  BANNER_HEIGHT,
  DATE_COLUMN_WIDTH,
  EVENT_PHOTO,
  FEEDBACK_CHEVRON_SIZE,
  FEEDBACK_ICON_SIZE,
  HEADING_ICON_SIZE,
  createStyles,
} from './CommunityScreen.styles';
import { PollOptionRow } from './PollOptionRow';

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the destination screen once it is designed.
}

/** Event rows' hairlines start at the photo, clear of the date column. */
const EVENT_DIVIDER_INSET = MEDIA_ROW_INSET_LEFT + DATE_COLUMN_WIDTH + MEDIA_ROW_LEADING_GAP;

const ALERT_ICON: Record<AlertLevel, 'warning-outline' | 'information-circle-outline'> = {
  warning: 'warning-outline',
  info: 'information-circle-outline',
};

export function CommunityScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Community'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);

  // Screen-local until there is a backend to send RSVPs and votes to.
  // TODO(api): persist both once the community service exists.
  const [rsvps, setRsvps] = useState<Record<string, RsvpStatus>>(() =>
    Object.fromEntries(upcomingEvents.map((event) => [event.id, event.rsvp])),
  );
  const [vote, setVote] = useState(currentPoll.myVote);
  const shares = useMemo(() => pollShares(currentPoll, vote), [vote]);

  const handleLogout = useCallback(() => {
    setMenuOpen(false);
    // Frontend only, as on Home: there is no session to clear yet.
    // TODO(auth): clear the stored session here once one exists.
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  const menuItems = useMemo<readonly AppMenuItem[]>(
    () => [{ id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: handleLogout }],
    [handleLogout],
  );

  // Registering marks the resident as going; tapping "I'm Going" withdraws.
  const toggleRsvp = (eventId: string) =>
    setRsvps((current) => {
      const status = current[eventId];
      if (status === 'soon') return current;
      return { ...current, [eventId]: status === 'going' ? 'open' : 'going' };
    });

  const renderRsvp = (event: CommunityEvent) => {
    const status = rsvps[event.id] ?? event.rsvp;
    const { label, tone } = rsvpDisplay[status];
    const chip = <StatusChip label={label} tone={tone} glow={status === 'going'} style={styles.rsvp} />;

    if (status === 'soon') {
      return chip;
    }
    return (
      <Pressable
        onPress={() => toggleRsvp(event.id)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={
          status === 'going' ? `Going to ${event.title}` : `Register for ${event.title}`
        }
        accessibilityHint={status === 'going' ? 'Withdraws your RSVP' : undefined}
        style={({ pressed }) => pressed && styles.pillPressed}
      >
        {chip}
      </Pressable>
    );
  };

  const renderDate = (isoDate: string) => {
    const { day, month } = dateParts(isoDate);
    return (
      <View style={styles.dateColumn}>
        <AppText variant="screenTitle">{day}</AppText>
        <AppText variant="statValue">{month}</AppText>
      </View>
    );
  };

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <PageHeader
            title={copy.title}
            onMenuPress={() => setMenuOpen(true)}
            style={styles.header}
          />

          <FeatureBanner
            title={copy.bannerTitle}
            body={copy.bannerBody}
            photo={images.communityHero}
            photoAspect={imageAspects.communityHero}
            height={BANNER_HEIGHT}
            style={styles.card}
          />

          <NeonPanel style={[styles.card, styles.list]}>
            <PanelHeading
              title={copy.announcementsTitle}
              iconSet="ionicons"
              iconName="megaphone-outline"
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
            />
            {announcements.map((item, index) => (
              <MediaRow
                key={item.id}
                divided={index > 0}
                photo={images[item.photo]}
                photoWidth={ANNOUNCEMENT_PHOTO.width}
                photoHeight={ANNOUNCEMENT_PHOTO.height}
                title={item.title}
                details={[item.body]}
                time={item.postedAgo}
                // TODO(nav): open the announcement once its detail screen is designed.
                onPress={notYetRouted}
                accessibilityHint="Shows the announcement"
              />
            ))}
          </NeonPanel>

          <NeonPanel style={[styles.card, styles.list]}>
            <PanelHeading
              title={copy.eventsTitle}
              iconSet="material"
              iconName="calendar-month-outline"
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
            />
            {upcomingEvents.map((event, index) => (
              <MediaRow
                key={event.id}
                divided={index > 0}
                dividerInsetLeft={EVENT_DIVIDER_INSET}
                leading={renderDate(event.date)}
                photo={images[event.photo]}
                photoWidth={EVENT_PHOTO.width}
                photoHeight={EVENT_PHOTO.height}
                title={event.title}
                details={[timeRange(event), event.venue]}
                action={renderRsvp(event)}
                // TODO(nav): open the event once its detail screen is designed.
                onPress={notYetRouted}
                accessibilityHint="Shows the event"
              />
            ))}
          </NeonPanel>

          <NeonPanel style={[styles.card, styles.list]}>
            <PanelHeading
              title={copy.alertsTitle}
              iconSet="ionicons"
              iconName="notifications-outline"
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
            />
            {communityAlerts.map((alert, index) => (
              <MediaRow
                key={alert.id}
                divided={index > 0}
                photo={images[alert.photo]}
                photoWidth={ALERT_PHOTO.width}
                photoHeight={ALERT_PHOTO.height}
                photoBadge={
                  <View
                    style={[
                      styles.alertBadge,
                      alert.level === 'warning' ? styles.alertBadgeWarning : styles.alertBadgeInfo,
                    ]}
                  >
                    <Ionicons
                      name={ALERT_ICON[alert.level]}
                      size={ALERT_BADGE_ICON_SIZE}
                      color={theme.colors.textPrimary}
                    />
                  </View>
                }
                title={alert.title}
                details={[alert.body]}
                time={alert.postedAgo}
                // TODO(nav): open the alert once its detail screen is designed.
                onPress={notYetRouted}
                accessibilityHint="Shows the alert"
              />
            ))}
          </NeonPanel>

          <NeonPanel style={[styles.card, styles.poll]}>
            <PanelHeading
              title={copy.pollTitle}
              subtitle={copy.pollSubtitle}
              iconSet="ionicons"
              iconName="stats-chart-outline"
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
              divider={false}
            />
            <View accessibilityRole="radiogroup">
              {currentPoll.options.map((option) => (
                <PollOptionRow
                  key={option.id}
                  label={option.label}
                  photo={images[option.photo]}
                  share={shares[option.id] ?? 0}
                  selected={vote === option.id}
                  onSelect={() => setVote(option.id)}
                />
              ))}
            </View>
          </NeonPanel>

          <NeonPanel style={[styles.card, styles.feedback]}>
            <View style={styles.feedbackPhoto}>
              <Image
                source={images.communityFeedback}
                style={styles.photoImage}
                resizeMode="cover"
                fadeDuration={0}
                accessibilityIgnoresInvertColors
              />
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={FEEDBACK_ICON_SIZE}
                color={theme.colors.textPrimary}
                style={styles.feedbackIcon}
              />
            </View>

            <View style={styles.feedbackText}>
              <AppText variant="sectionTitle" accessibilityRole="header">
                {copy.feedbackTitle}
              </AppText>
              <AppText
                variant="tileCaption"
                color={theme.colors.textSupport}
                style={styles.feedbackBody}
              >
                {copy.feedbackBody}
              </AppText>
            </View>

            <Pressable
              // TODO(nav): open the feedback form once it is designed.
              onPress={notYetRouted}
              hitSlop={9}
              accessibilityRole="button"
              accessibilityLabel={copy.feedbackCta}
              style={({ pressed }) => [styles.feedbackButton, pressed && styles.pillPressed]}
            >
              {/* Laid on the panel's glass, so it skips its own blur. */}
              <GlassSurface
                radius={theme.borderRadius.sm}
                glow
                blurred={false}
                strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
                fillOpacity={theme.glass.subtleFillOpacity}
                style={styles.feedbackButtonSurface}
              >
                <AppText variant="statValue">{copy.feedbackCta}</AppText>
                <Ionicons
                  name="chevron-forward"
                  size={FEEDBACK_CHEVRON_SIZE}
                  color={theme.colors.textPrimary}
                />
              </GlassSurface>
            </Pressable>
          </NeonPanel>
        </ScrollView>

        {/* The same empty glass bar as Visitor Access, Maintenance and Parking. */}
        <BottomBar />
      </View>

      <AppMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        align="right"
      />
    </ScreenWrapper>
  );
}
