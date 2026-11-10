import { useCallback, useEffect, useState } from 'react';

import { consentStore } from '../services/consentStore';

export type AssistantConsent = 'loading' | 'needed' | 'given';

/**
 * Whether this phone's resident agreed to the Parklane Assistant sending what they type, say
 * and show to its AI providers. Asked once, before the first message or call.
 */
export function useAssistantConsent() {
  const [consent, setConsent] = useState<AssistantConsent>('loading');

  useEffect(() => {
    let live = true;
    consentStore
      .read()
      .then((given) => {
        if (live) setConsent(given ? 'given' : 'needed');
      })
      .catch(() => {
        if (live) setConsent('needed');
      });
    return () => {
      live = false;
    };
  }, []);

  const agree = useCallback(() => {
    setConsent('given');
    consentStore.save().catch(() => undefined);
  }, []);

  return { consent, agree };
}
