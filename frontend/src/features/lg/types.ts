/** The LG pairing wizard's state, as useLgPairing holds it and the screen draws it. */

export type LgPairingStep = 'prepare' | 'wifi' | 'join' | 'finish';

/** After the AC took the settings: the phone back home, the gateway finding the AC on ReThink, then paired. */
export type LgFinishPhase = 'home' | 'find' | 'done';

export interface LgPairingError {
  title: string;
  message: string;
}

export type LgBackendCheck = { state: 'checking' } | { state: 'ready' } | { state: 'failed'; message: string };

export interface HomeWifi {
  ssid: string;
  /** Empty for an open network. */
  password: string;
}

export interface NearbyNetwork {
  ssid: string;
}
