import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * Only the implemented screen is registered. Later screens are added here
 * alongside their params, which keeps navigation calls type-checked.
 */
export type RootStackParamList = {
  FirstScreen: undefined;
  Login: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

declare global {
  namespace ReactNavigation {
    // Module augmentation: React Navigation reads the app's routes from here,
    // so the interface deliberately adds no members of its own.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
