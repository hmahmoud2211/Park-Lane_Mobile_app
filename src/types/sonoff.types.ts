/**
 * SONOFF Wi-Fi pairing: what the plug reports from its setup hotspot, and the
 * stages of adding it through the unit's backend to the CUBE hub.
 */

/**
 * The plug's own key, as `GET http://10.10.7.1/device` reports it (`apikey`).
 * The eWeLink LAN protocol encrypts with it, so it is as private as a
 * password: sealed so that logging, string conversion or JSON serialisation
 * never prints it, and read only where it is sent to the unit's backend.
 */
export interface DeviceKey {
  reveal(): string;
  toString(): string;
  toJSON(): string;
}

/**
 * The parts of `/device` that are safe to show. It reports no model, so the
 * app never shows one as confirmed.
 */
export interface SonoffDeviceInfo {
  /** e.g. `1000abcdef`. Not a secret: it names the plug on the LAN. */
  deviceId: string;
  chipId: string;
  /** `"post"` on the firmware tested so far. */
  accept: string;
}

export interface SonoffDetection {
  info: SonoffDeviceInfo;
  key: DeviceKey;
}

/** Where the phone stands relative to the plug's setup hotspot. */
export interface DeviceNetworkState {
  /** The network the phone reports, or null when the platform will not say. */
  ssid: string | null;
  /** True only once `/device` has answered; null when not yet checked. */
  deviceReachable: boolean | null;
}

/**
 * The stages a resident sees, in order. Failure and "needs registration"
 * stages can be reached from several points and say what happened.
 */
export type PairingStatus =
  | 'waitingForPairing'
  | 'connectingToDevice'
  | 'deviceDetected'
  | 'configuringWifi'
  | 'waitingForReconnection'
  | 'deviceDiscovered'
  | 'provisioningFailed'
  | 'registrationRequired'
  | 'setupCompleted';

/** The wizard's pages; several statuses share a page. */
export type PairingStep = 'instructions' | 'connect' | 'wifi' | 'progress';

/** Every failure the flow distinguishes, so each gets its own advice. */
export type PairingErrorKind =
  | 'hotspotNotFound'
  | 'wrongNetwork'
  | 'joinCancelled'
  | 'permissionDenied'
  | 'locationServicesOff'
  | 'localNetworkDenied'
  | 'timeout'
  | 'invalidResponse'
  | 'unsupportedPlatform'
  | 'provisioningUnsupported'
  | 'provisioningRejected'
  | 'stillInPairingMode'
  | 'notOnHomeWifi'
  | 'deviceNotFound'
  | 'keyRejected'
  | 'notControllable'
  | 'unsupportedDevice'
  | 'backendNotConfigured'
  | 'backendUnreachable'
  | 'cubeUnreachable'
  | 'cubeRejected'
  | 'unknown';

export interface PairingError {
  kind: PairingErrorKind;
  message: string;
}

/** The body the experimental `/ap` request sends, without the password. */
export type ApPayloadFormat = 'ewelinkApp' | 'sonotaV4';

/** What the plug did with an experimental `/ap` request. */
export type ApProvisioningOutcome =
  /** HTTP 200 with `{"error":0}`: the plug took the settings. Not proof it joined. */
  | { kind: 'accepted' }
  /** It answered, but not with `error: 0`. */
  | { kind: 'rejected'; status: number; code?: number }
  /** No answer in time, or it dropped the connection. Proves nothing either way. */
  | { kind: 'noResponse' }
  /** The request never reached the plug. */
  | { kind: 'unreachable' };

/** The plug as the backend found it on the home network. */
export interface SonoffLanDevice {
  deviceId: string;
  host: string;
  port: number;
  /** Whether its LAN announcements are encrypted (stock firmware) or plain (DIY mode). */
  encrypted: boolean;
  /** True when the key decrypted its announcement; null when there was nothing to check. */
  keyVerified: boolean | null;
  power: 'on' | 'off' | null;
  /** True when it reported a single `switch`, which is all the bridge can drive. */
  singleChannel: boolean;
}

/** A device on the hub, as the unit's backend lists it. */
export interface BackendDevice {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  model: string;
  online: boolean;
  power: 'on' | 'off' | null;
  controllable: boolean;
}

export interface SonoffRegistration {
  /** The hub's serial number for the plug. */
  cubeSerial: string;
  /** False when the plug was already registered and this only refreshed it. */
  created: boolean;
  device: SonoffLanDevice;
}
