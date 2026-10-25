import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactNode, type Ref } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { useSideNav } from '../../hooks/useSideNav';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';
import { DirectionView } from '../common/DirectionView';
import { BottomBar, NAV_BAR_CLEARANCE } from '../layout/BottomBar';
import { PageHeader } from '../layout/PageHeader';
import { ResponsiveColumns } from '../layout/ResponsiveColumns';
import { ScreenWrapper } from '../layout/ScreenWrapper';

export interface ParkingFrameProps {
  title: string;
  children: ReactNode;
  /** Resident screens keep the app's bottom bar; visitor and security pages do not. */
  bottomBar?: boolean;
  showBack?: boolean;
  headerTrailing?: ReactNode;
  onMenuPress?: () => void;
  scrollRef?: Ref<ScrollViewInstance>;
  /** Lays the page out right-to-left, for Arabic. The header keeps its place. */
  rtl?: boolean;
  /** A quieter line under the title, e.g. "Step 2 of 2". */
  subtitle?: string;
  /** Replaces the back ring's default, e.g. to go back a step. */
  onBack?: () => void;
  /** Pinned under the scrolling content, e.g. a flow's main button. Use with `bottomBar={false}`. */
  footer?: ReactNode;
  /**
   * The page's secondary sections. Where the page has room for two columns
   * they sit beside `children`; elsewhere they follow them, `children` first,
   * so pass the tail of the phone order. Leave out rather than pass an empty
   * fragment, which would still take a gap.
   */
  aside?: ReactNode;
  /** Relative widths of `children` and `aside` side by side; equal by default. */
  columnWeights?: readonly [number, number];
  /**
   * Lets the content run the full wide-layout width without an aside, for a
   * screen that lays out its own columns. Otherwise a single column stops at
   * a comfortable reading width on tablets and desktops.
   */
  wide?: boolean;
  /**
   * Keeps the side rail on tablets and desktops for a resident page drawn
   * without the bottom bar, e.g. a flow with a pinned footer. Defaults to
   * `bottomBar`, whose bar asks for the rail itself.
   */
  sideNav?: boolean;
}

/** Gutter shared with the Parking screen, so cards line up across the flow. */
const GUTTER = 16;
const HEADER_GUTTER = 35;
const HEADER_TO_CONTENT = 22;
/** Space between the cards of a page; screens laying out their own columns use it too. */
export const PARKING_BODY_GAP = 14;
/** Space kept below the last card, over and above the bottom bar. */
const END_GAP = 32;

/**
 * The page shell for the parking flows: the Parking screen's backdrop,
 * header and gutter, a keyboard-aware scroll view, and bottom padding that
 * always clears the floating bottom bar and the device's home indicator.
 */
export function ParkingFrame({
  title,
  children,
  bottomBar = true,
  showBack = true,
  headerTrailing,
  onMenuPress,
  scrollRef,
  rtl = false,
  subtitle,
  onBack,
  footer,
  aside,
  columnWeights,
  wide = false,
  sideNav = bottomBar,
}: ParkingFrameProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  // The safe area is already outside this view (ScreenWrapper), so only the
  // bar needs clearing. Wide layouts have the rail instead of the bar.
  const bottomPad = (bottomBar && !layout.isWide ? NAV_BAR_CLEARANCE : 0) + END_GAP;

  // Phones keep the measured 16dp gutter and 520dp cap; wider frames take the
  // device class's gutter, and the full width only when the page has columns.
  const fullWidth = wide || aside != null;
  const readingWidth = Math.min(layout.contentMaxWidth, theme.layout.contentMaxWidth.tablet);
  const wideFrame = (maxWidth: number) =>
    layout.isWide ? { maxWidth: maxWidth + 2 * layout.gutter, paddingHorizontal: layout.gutter } : null;

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.42}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.content,
              wideFrame(fullWidth ? layout.contentMaxWidth : readingWidth),
              { paddingBottom: bottomPad },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <PageHeader
              title={title}
              subtitle={subtitle}
              onBackPress={onBack}
              showBack={showBack}
              trailing={headerTrailing}
              onMenuPress={onMenuPress}
              style={styles.header}
            />
            <DirectionView direction={rtl ? 'rtl' : undefined} style={styles.body}>
              {aside != null ? (
                <ResponsiveColumns gap={PARKING_BODY_GAP} weights={columnWeights}>
                  <>{children}</>
                  <>{aside}</>
                </ResponsiveColumns>
              ) : (
                children
              )}
            </DirectionView>
          </ScrollView>
          {/*
           * The pinned button keeps to a reading width, however wide the page;
           * beside two columns it sits under the second, where a form ends.
           */}
          {footer ? (
            <View style={[styles.footer, wideFrame(fullWidth ? layout.contentMaxWidth : readingWidth)]}>
              <View style={fullWidth && layout.columns > 1 ? { width: layout.columnWidth, alignSelf: 'flex-end' } : null}>
                {footer}
              </View>
            </View>
          ) : null}
          {bottomBar ? <BottomBar /> : sideNav ? <SideNavRequest /> : null}
        </View>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}

/** Asks for the side rail on a page without the bottom bar, which would otherwise ask. */
function SideNavRequest() {
  useSideNav();
  return null;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingTop: theme.spacing.headerTop,
      paddingHorizontal: GUTTER,
    },
    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_CONTENT,
    },
    body: {
      gap: PARKING_BODY_GAP,
    },
    footer: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingHorizontal: GUTTER,
      paddingTop: 8,
      paddingBottom: 12,
    },
  });
}
