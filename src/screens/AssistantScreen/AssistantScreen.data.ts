import type { Suggestion } from '../../components/assistant/SuggestionChips';

/**
 * Copy for the assistant screen. Suggestions ask one thing each: the
 * assistant answers a single topic per question (FRONTEND_INTEGRATION.md §7).
 * The Arabic user guide (docs/دليل_المساعد_الذكي.docx) has more examples.
 */
export const assistantCopy = {
  title: 'Assistant',
  greeting: (name: string | null) => (name ? `Hi ${name},` : 'Hi there,'),
  headline: 'How can I help you today?',
  intro: 'Ask about your unit, visitors, parking, the building or the weather, in Arabic or English.',
  voiceIdleTitle: 'Talk to Parklane',
  voiceIdleBody: 'Tap start, then just speak. Turn the camera on and ask "what is this?" to show me something.',
  voiceLanguageNote: 'Replies are spoken in Egyptian Arabic.',
  voiceTryLabel: 'Try saying',
  interruptHalfDuplex: 'Tap the orb to interrupt',
  interruptDuplex: 'Just start talking to interrupt',
  listeningHint: "Go ahead, I'm listening",
  cameraDenied: 'Camera access is off. You can allow it in Settings.',
  offline: "Can't reach the assistant right now.",
  retry: 'Retry',
  newConversation: 'New conversation',
  guest: 'Guest (not signed in)',
} as const;

export const chatSuggestions: readonly Suggestion[] = [
  { id: 'installment', text: 'When is my next installment?', icon: 'wallet-outline' },
  { id: 'visitors', text: 'Do I have visitors today?', icon: 'people-outline' },
  { id: 'parking', text: 'Where is my parking slot?', icon: 'car-outline' },
  { id: 'alarms', text: 'Any active alarms in the building?', icon: 'notifications-outline' },
  { id: 'generator', text: 'حالة المولد إيه دلوقتي؟', icon: 'flash-outline' },
  { id: 'energy', text: 'How much energy did we use yesterday?', icon: 'stats-chart-outline' },
  { id: 'weather', text: "What's the weather today?", icon: 'partly-sunny-outline' },
  { id: 'community', text: 'Any community news?', icon: 'megaphone-outline' },
];

/** Spoken examples on the idle voice screen. */
export const voiceExamples: readonly string[] = [
  'ايه حالة المولد؟',
  'Any alarms right now?',
  'امتى القسط الجاي؟',
];
