import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';

import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
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
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusChip } from '../../components/ui/StatusChip';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  announcements,
  communityAlerts,
  communityCopy as copy,
  currentPoll,
  dateParts,
  pastPolls,
  pollShares,
  rsvpDisplay,
  shownCounts,
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
import { FeedbackForm } from './FeedbackForm';
import { PollOptionRow } from './PollOptionRow';

/** The panels whose "View All" opens the full list in place. */
type ExpandablePanel = 'announcements' | 'events' | 'alerts' | 'polls';

/** Space kept above a panel the screen scrolls to, so its heading clears the edge. */
const SCROLL_MARGIN = 12;

/** Event rows' hairlines start at the photo, clear of the date column. */
const EVENT_DIVIDER_INSET = MEDIA_ROW_INSET_LEFT + DATE_COLUMN_WIDTH + MEDIA_ROW_LEADING_GAP;

const ALERT_ICON: Record<AlertLevel, 'warning-outline' | 'information-circle-outline'> = {
  warning: 'warning-outline',
  info: 'information-circle-outline',
};

export function CommunityScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const sideBySide = layout.columns > 1;
  const columnsY = useRef(0);
  const navigation = useNavigation<RootStackScreenProps<'Community'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);

  // Screen-local until there is a backend to send RSVPs and votes to.
  // TODO(api): persist both once the community service exists.
  const [rsvps, setRsvps] = useState<Record<string, RsvpStatus>>(() =>
    Object.fromEntries(upcomingEvents.map((event) => [event.id, event.rsvp])),
  );
  const [vote, setVote] = useState(currentPoll.myVote);
  const shares = useMemo(() => pollShares(currentPoll, vote), [vote]);
  const [expanded, setExpanded] = useState<Record<ExpandablePanel, boolean>>({
    announcements: false,
    events: false,
    alerts: false,
    polls: false,
  });
  /** The one row opened to its full text, across all lists. */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // TODO(api): send feedback to management once the community service exists.
  const [feedbackSent, setFeedbackSent] = useState(false);

  const scroll = useRef<ScrollView>(null);
  const scrollToFeedback = useRef(false);

  // "View All" opens the panel's full list in place; "Show Less" folds it back.
  const viewAll = (panel: ExpandablePanel) => ({
    actionLabel: expanded[panel] ? copy.showLess : copy.viewAll,
    actionExpanded: expanded[panel],
    onActionPress: () => setExpanded((current) => ({ ...current, [panel]: !current[panel] })),
  });
  const shown = <T,>(items: readonly T[], panel: Exclude<ExpandablePanel, 'polls'>) =>
    expanded[panel] ? items : items.slice(0, shownCounts[panel]);

  // A row opens to its full text; tapping it again, or another row, closes it.
  const rowProps = (id: string, text: string) => ({
    onPress: () => setOpenRow((current) => (current === id ? null : id)),
    expanded: openRow === id,
    expandedContent: (
      <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.rowMore}>
        {text}
      </AppText>
    ),
  });

  const openFeedback = () => {
    setFeedbackSent(false);
    // Scrolled to once the form has laid out (see its onLayout).
    scrollToFeedback.current = true;
    setFeedbackOpen(true);
  };

  // The form hands over a valid message; with no service yet, it is only
  // acknowledged here.
  const sendFeedback = () => {
    setFeedbackOpen(false);
    setFeedbackSent(true);
    AccessibilityInfo.announceForAccessibility(copy.feedbackThanks);
  };

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

  // Opened from the Resident Feedback card: under it, which beside two columns
  // means inside the second one. Offsets there start from the columns' top.
  const feedbackForm = feedbackOpen ? (
    <View
      onLayout={(event) => {
        if (scrollToFeedback.current) {
          scrollToFeedback.current = false;
          const y = (sideBySide ? columnsY.current : 0) + event.nativeEvent.layout.y;
          scroll.current?.scrollTo({ y: Math.max(0, y - SCROLL_MARGIN), animated: true });
        }
      }}
    >
      <FeedbackForm onSubmit={sendFeedback} onClose={() => setFeedbackOpen(false)} style={styles.card} />
    </View>
  ) : null;

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      {/* The feedback form types; as on Visitor Access, iOS pads for the keyboard. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.content, layout.contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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

          {/* News down one side, the poll and feedback down the other, when wide. */}
          {/* The cards carry their own spacing, so the columns add none. */}
          <View
            onLayout={(event) => {
              columnsY.current = event.nativeEvent.layout.y;
            }}
          >
            <ResponsiveColumns gap={0}>
              <>
                <NeonPanel style={[styles.card, styles.list]}>
                  <PanelHeading
                    title={copy.announcementsTitle}
                    iconSet="ionicons"
                    iconName="megaphone-outline"
                    iconSize={HEADING_ICON_SIZE}
                    {...viewAll('announcements')}
                  />
                  {shown(announcements, 'announcements').map((item, index) => (
                    <MediaRow
                      key={item.id}
                      divided={index > 0}
                      photo={item.photo ? images[item.photo] : undefined}
                      icon={item.icon}
                      photoWidth={ANNOUNCEMENT_PHOTO.width}
                      photoHeight={ANNOUNCEMENT_PHOTO.height}
                      title={item.title}
                      details={[item.body]}
                      time={item.postedAgo}
                      {...rowProps(item.id, item.fullText)}
                      accessibilityHint="Shows the full announcement"
                    />
                  ))}
                </NeonPanel>

                <NeonPanel style={[styles.card, styles.list]}>
                  <PanelHeading
                    title={copy.eventsTitle}
                    iconSet="material"
                    iconName="calendar-month-outline"
                    iconSize={HEADING_ICON_SIZE}
                    {...viewAll('events')}
                  />
                  {shown(upcomingEvents, 'events').map((event, index) => (
                    <MediaRow
                      key={event.id}
                      divided={index > 0}
                      dividerInsetLeft={EVENT_DIVIDER_INSET}
                      leading={renderDate(event.date)}
                      photo={event.photo ? images[event.photo] : undefined}
                      icon={event.icon}
                      photoWidth={EVENT_PHOTO.width}
                      photoHeight={EVENT_PHOTO.height}
                      title={event.title}
                      details={[timeRange(event), event.venue]}
                      action={renderRsvp(event)}
                      {...rowProps(event.id, event.description)}
                      accessibilityHint="Shows the event's details"
                    />
                  ))}
                </NeonPanel>

                <NeonPanel style={[styles.card, styles.list]}>
                  <PanelHeading
                    title={copy.alertsTitle}
                    iconSet="ionicons"
                    iconName="notifications-outline"
                    iconSize={HEADING_ICON_SIZE}
                    {...viewAll('alerts')}
                  />
                  {shown(communityAlerts, 'alerts').map((alert, index) => (
                    <MediaRow
                      key={alert.id}
                      divided={index > 0}
                      photo={alert.photo ? images[alert.photo] : undefined}
                      icon={alert.icon}
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
                      {...rowProps(alert.id, alert.fullText)}
                      accessibilityHint="Shows the full alert"
                    />
                  ))}
                </NeonPanel>
              </>
              <>
                <NeonPanel style={[styles.card, styles.poll]}>
                  <PanelHeading
                    title={copy.pollTitle}
                    subtitle={copy.pollSubtitle}
                    iconSet="ionicons"
                    iconName="stats-chart-outline"
                    iconSize={HEADING_ICON_SIZE}
                    {...viewAll('polls')}
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
                  {expanded.polls ? (
                    <View style={styles.pastPolls}>
                      <AppText
                        variant="statLabel"
                        color={theme.colors.textSupport}
                        style={styles.pastPollsTitle}
                      >
                        {copy.pastPollsTitle}
                      </AppText>
                      {pastPolls.map((poll) => {
                        const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
                        return (
                          <View key={poll.id}>
                            <AppText variant="statValue">{poll.question}</AppText>
                            <AppText
                              variant="tileCaption"
                              color={theme.colors.textSupport}
                              style={styles.pastPollMeta}
                            >
                              {`${copy.pollClosed(poll.closedOn)} · ${copy.pollVotes(total)}`}
                            </AppText>
                            {poll.options.map((option) => {
                              const share = total > 0 ? option.votes / total : 0;
                              const percent = `${Math.round(share * 100)}%`;
                              return (
                                <View
                                  key={option.id}
                                  style={styles.pastOption}
                                  accessible
                                  accessibilityLabel={`${option.label}, ${percent}`}
                                >
                                  <AppText
                                    variant="tileCaption"
                                    numberOfLines={1}
                                    style={styles.pastOptionLabel}
                                  >
                                    {option.label}
                                  </AppText>
                                  <ProgressBar
                                    progress={share}
                                    height={6}
                                    accessibilityLabel={percent}
                                    style={styles.pastOptionBar}
                                  />
                                  <AppText variant="tileCaption" style={styles.pastOptionShare}>
                                    {percent}
                                  </AppText>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
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
                    {feedbackSent ? (
                      <AppText
                        variant="tileCaption"
                        color={theme.colors.success}
                        accessibilityLiveRegion="polite"
                        style={styles.feedbackThanks}
                      >
                        {copy.feedbackThanks}
                      </AppText>
                    ) : null}
                  </View>

                  <Pressable
                    onPress={openFeedback}
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
                {sideBySide ? feedbackForm : null}
              </>
            </ResponsiveColumns>
          </View>

          {sideBySide ? null : feedbackForm}
        </ScrollView>

        {/* The same empty glass bar as Visitor Access, Maintenance and Parking. */}
        <BottomBar />
      </KeyboardAvoidingView>

      <AppMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        align="right"
      />
    </ScreenWrapper>
  );
}
