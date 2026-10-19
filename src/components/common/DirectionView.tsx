import { createContext } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

export type LayoutDirection = 'ltr' | 'rtl';

/** The direction set by the nearest DirectionView, so text inside can follow it. Undefined outside one. */
export const LayoutDirectionContext = createContext<LayoutDirection | undefined>(undefined);

export interface DirectionViewProps extends ViewProps {
  /** Lays this subtree out in one direction, whatever the app's own. Omitted, it inherits. */
  direction?: LayoutDirection;
}

/**
 * A View with its own layout direction, e.g. an Arabic page in an English
 * app: Yoga's `direction` style on iOS and Android, and the HTML `dir`
 * attribute on web, where react-native-web has no `direction` style.
 */
export function DirectionView({ direction, style, children, ...rest }: DirectionViewProps) {
  if (!direction) {
    return (
      <View {...rest} style={style}>
        {children}
      </View>
    );
  }
  // react-native-web passes `dir` through to the element; React Native's types don't list it.
  const platform = Platform.OS === 'web' ? ({ dir: direction } as ViewProps) : null;
  return (
    <LayoutDirectionContext.Provider value={direction}>
      <View {...rest} {...platform} style={platform ? style : [style, { direction }]}>
        {children}
      </View>
    </LayoutDirectionContext.Provider>
  );
}
