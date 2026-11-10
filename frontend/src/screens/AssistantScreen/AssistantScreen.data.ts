import { flags } from '../../config/flags';
import type { Suggestion } from '../../features/assistant/components/SuggestionChips';

/**
 * Copy for the assistant screen. Suggestions ask one thing each: the
 * assistant answers a single topic per question (FRONTEND_INTEGRATION.md §7).
 * The Arabic user guide (docs/دليل_المساعد_الذكي.docx) has more examples.
 */
export const assistantCopy = {
  title: 'Assistant',
  greeting: (name: string | null) => (name ? `Hi ${name},` : 'Hi there,'),
  headline: 'How can I help you today?',
  /** Broken as in the design (assets/Screens/screen14.png). */
  intro: flags.sampleContent
    ? 'Ask about your unit, visitors, parking,\nthe building or the weather,\nin Arabic or English.'
    : 'Ask about your home’s devices\nor the weather,\nin Arabic or English.',
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

/** The four the design shows, two across. Sent as typed, so no line breaks. */
const sampleChatSuggestions: readonly Suggestion[] = [
  { id: 'installment', text: 'When is my next installment?', icon: 'wallet-outline' },
  { id: 'visitors', text: 'Do I have visitors today?', icon: 'people-outline' },
  { id: 'parking', text: 'Where is my parking slot?', icon: 'car-outline' },
  { id: 'alarms', text: 'Any active alarms in the building?', icon: 'notifications-outline' },
];

/** The store build's: only what the assistant can answer for any signed-in resident. */
export const chatSuggestions: readonly Suggestion[] = flags.sampleContent
  ? sampleChatSuggestions
  : [
      { id: 'lights', text: 'Turn off the living room lights', icon: 'bulb-outline' },
      { id: 'devices', text: 'Which of my devices are on?', icon: 'hardware-chip-outline' },
      { id: 'weather', text: 'What is the weather today?', icon: 'partly-sunny-outline' },
    ];

/** Spoken examples on the idle voice screen. */
const sampleVoiceExamples: readonly string[] = [
  'ايه حالة المولد؟',
  'Turn off the living room lights',
  'امتى القسط الجاي؟',
];

export const voiceExamples: readonly string[] = flags.sampleContent
  ? sampleVoiceExamples
  : ['Turn off the living room lights', 'شغل التكييف'];

/** Before the first message or call (App Store 5.1.2(i): third-party AI needs explicit permission). */
export const assistantConsentCopy = {
  title: 'Before you use the assistant',
  intro: 'The Parklane Assistant is powered by artificial intelligence from outside companies.',
  points: (providers: string | null) => [
    'What you type, your voice during a voice conversation, and any camera picture you choose to show are sent to the Parklane Assistant service and its AI providers' +
      (providers ? ` (${providers})` : '') +
      ', so they can understand you and answer.',
    'If you are signed in, it can also read and control your apartment’s devices when you ask it to.',
    'Its answers can be wrong. It does not give medical, legal or safety advice. Please do not share health details here; use Health Passport for those.',
  ],
  agree: 'I agree',
  decline: 'Not now',
  privacy: 'Read the privacy policy',
} as const;
