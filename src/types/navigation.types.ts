import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * Only the implemented screen is registered. Later screens are added here
 * alongside their params, which keeps navigation calls type-checked.
 */
export type RootStackParamList = {
  FirstScreen: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
