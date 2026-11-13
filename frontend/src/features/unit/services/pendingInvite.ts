/**
 * An invite code waiting for the resident to sign in. An invite link can open the app before
 * anyone is signed in; the code is kept here (in memory, for this launch) while they sign in or
 * create an account, and the navigator opens the invite again as soon as they are in
 * (navigation/AppNavigator.tsx). No React, so the navigator and screens share it.
 */

let pending: string | null = null;

export function keepInviteForSignIn(code: string): void {
  pending = code;
}

/** The waiting code, once: taking it clears it. */
export function takePendingInvite(): string | null {
  const code = pending;
  pending = null;
  return code;
}
