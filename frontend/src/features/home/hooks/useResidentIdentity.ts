import { useMemo } from 'react';

import { flags } from '../../../config/flags';
import { initialsOf, resident } from '../../../data/demoResident';
import { useEms } from '../../ems/hooks/useEms';

export interface ResidentIdentity {
  greeting: string;
  firstName: string;
  /** The whole name, or the guest's label. */
  fullName: string;
  /** For the header avatar. */
  initials: string;
  tagline: string;
  /** The account's email, when someone is signed in. */
  email: string | null;
}

function greetingAt(hour: number): string {
  if (hour < 12) return 'Good morning,';
  return hour < 18 ? 'Good afternoon,' : 'Good evening,';
}

function initialsOfName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * Who Home and Profile greet. The store build shows the signed-in account (flags.storeMode);
 * development and preview builds keep the demo resident the designs are drawn with.
 */
export function useResidentIdentity(): ResidentIdentity {
  const { status, user } = useEms();
  const signedInName = status === 'signedIn' ? user?.name.trim() || null : null;
  const email = status === 'signedIn' ? (user?.email ?? null) : null;
  const hour = new Date().getHours();

  return useMemo(() => {
    if (flags.sampleContent) {
      return {
        greeting: resident.greeting,
        firstName: resident.firstName,
        fullName: `${resident.firstName} ${resident.lastName}`,
        initials: initialsOf(resident),
        tagline: resident.tagline,
        email: null,
      };
    }
    const name = signedInName ?? 'Guest';
    return {
      greeting: signedInName ? greetingAt(hour) : 'Welcome,',
      firstName: name.split(/\s+/)[0],
      fullName: name,
      initials: initialsOfName(name),
      tagline: resident.tagline,
      email,
    };
  }, [signedInName, email, hour]);
}
