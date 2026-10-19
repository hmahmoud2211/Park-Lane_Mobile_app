import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactNode, type Ref } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';
import { DirectionView } from '../common/DirectionView';
import { BottomBar, NAV_BAR_CLEARANCE } from '../layout/BottomBar';
import { PageHeader } from '../layout/PageHeader';
import { ScreenWrapper } from '../layout/ScreenWrapper';

export interface ParkingFrameProps {
  title: string;
  children: ReactNode;
  /** Resident screens keep the app's bottom bar; visitor and security pages do not. */
  bottomBar?: boolean;
  showBack?: boolean;
  headerTrailing?: ReactNode;
  onMenuPress?: () => void;
  scrollRef?: Ref<ScrollView>;
  /** Lays the page out right-to-left, for Arabic. The header keeps its place. */
  rtl?: boolean;
  /** A quieter line under the title, e.g. "Step 2 of 2". */
  subtitle?: string;
  /** Replaces the back ring's default, e.g. to go back a step. */
  onBack?: () => void;
  /** Pinned under the scrolling content, e.g. a flow's main button. Use with `bottomBar={false}`. */
  footer?: ReactNode;
}

/** Gutter shared with the Parking screen, so cards line up across the flow. */
const GUTTER = 16;
const HEADER_GUTTER = 35;
const HEADER_TO_CONTENT = 22;
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
}: ParkingFrameProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // The safe area is already outside this view (ScreenWrapper), so only the bar needs clearing.
  const bottomPad = (bottomBar ? NAV_BAR_CLEARANCE : 0) + END_GAP;

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.42}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <PageHeader
              title={title}
              subtitle={subtitle}
              onBack={onBack}
              showBack={showBack}
              trailing={headerTrailing}
              onMenuPress={onMenuPress}
              style={styles.header}
            />
            <DirectionView direction={rtl ? 'rtl' : undefined} style={styles.body}>
              {children}
            </DirectionView>
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
          {bottomBar ? <BottomBar /> : null}
        </View>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
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
      gap: 14,
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
