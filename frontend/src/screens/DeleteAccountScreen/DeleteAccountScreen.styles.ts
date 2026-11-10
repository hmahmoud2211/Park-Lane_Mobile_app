import { StyleSheet } from 'react-native';

import { NAV_BAR_CLEARANCE } from '../../components/layout/BottomBar';
import { layout } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../utils/responsive';

/** No Figma reference: the inner screens' rhythm (layout.innerScreen) with Settings' header spacing. */
const GUTTER = layout.innerScreen.gutter;
const HEADER_GUTTER = layout.innerScreen.headerGutter;
const HEADER_TO_PANEL = 30;
const PANEL_PADDING = 18;
export const FIELD_HEIGHT = layout.innerScreen.buttonHeight;
export const FIELD_ICON_SIZE = 17;

export function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingTop: theme.spacing.headerTop,
      paddingHorizontal: GUTTER,
      paddingBottom: NAV_BAR_CLEARANCE + theme.spacing.xl,
    },
    header: {
      marginHorizontal: HEADER_GUTTER - GUTTER,
      marginBottom: HEADER_TO_PANEL,
    },
    panel: {
      padding: PANEL_PADDING,
    },
    sectionHeading: {
      marginBottom: theme.spacing.xs,
    },
    keptHeading: {
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.xs,
    },
    bullet: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    bulletText: {
      flex: 1,
    },
    form: {
      marginTop: theme.spacing.xl,
    },
    understandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginTop: theme.spacing.lg,
    },
    understandText: {
      flex: 1,
    },
    error: {
      marginTop: theme.spacing.md,
    },
    submit: {
      marginTop: theme.spacing.lg,
    },
  });
}
