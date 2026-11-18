/** Family Circle as the EMS backend serves it; change the wire types in shared/contracts/circles.ts. */
export type * from '../../../../shared/contracts/circles';

/** What the phone lets Park-Lane do with its location. */
export type LocationAccess =
  /** "Always" (iOS) / "Allow all the time" (Android): sharing keeps going with the app closed. */
  | 'always'
  /** Only while the app is open. */
  | 'whileUsing'
  /** Not asked yet. */
  | 'undetermined'
  /** Refused; only the phone's settings can change it now. */
  | 'denied'
  /** The web app: no background location. */
  | 'unsupported';
