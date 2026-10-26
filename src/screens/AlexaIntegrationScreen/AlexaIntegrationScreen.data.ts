import type { StatusTone } from '../../components/ui/StatusChip';
import type { AlexaLinkStatus } from '../../types/ems.types';

/**
 * Copy for the Alexa integration. The skill is a Custom Skill ("EMS Voice
 * Control"): devices are switched by talking to the skill, and they do not
 * appear in the Alexa app's own Devices list.
 */

export const alexaCopy = {
  title: 'Alexa',
  subtitle: 'Control your EMS devices by voice.',
  accountIntro: 'Alexa links to your EMS account. Sign in first, then connect Alexa.',
  connectionTitle: 'Amazon Alexa',
  connectionBody:
    'Connect once with your Amazon account. You do not need the Alexa app: Amazon’s sign-in opens in your browser and returns here.',
  connect: 'Connect to Alexa',
  reconnect: 'Connect again',
  disconnect: 'Disconnect Alexa',
  check: 'Check status',
  notConfigured:
    'Alexa linking is not set up on the EMS backend yet. An administrator needs to add the skill’s Amazon settings.',
  customSkillNote:
    'EMS Voice Control is a Custom Skill: you talk to it by name, and your devices do not appear in the Alexa app’s Devices list.',
  commandsTitle: 'Voice commands',
  accessTitle: 'Device access',
  accessBody: 'Choose which devices Alexa may switch, and the default for “turn on” with no device named.',
  manageDevices: 'Manage devices',
  noDevices: 'No devices yet. Add one in My Devices, then come back to allow it here.',
  defaultLabel: 'Default',
  setDefault: 'Make default',
  troubleshootingTitle: 'If Alexa says it cannot reach a device',
  troubleshooting: [
    'Check the device shows “Online” in My Devices.',
    'Make sure the device is allowed in Device access below.',
    'Say the name exactly as it appears here, or add the room: “bedroom light”.',
    'If Alexa asks you to link your account, connect again on this page.',
  ],
} as const;

export const statusDisplay: Record<AlexaLinkStatus, { label: string; tone: StatusTone; icon: 'checkmark-circle' | 'ellipse-outline' | 'alert-circle' | 'time-outline' }> = {
  linked: { label: 'Connected', tone: 'teal', icon: 'checkmark-circle' },
  unlinked: { label: 'Not connected', tone: 'slate', icon: 'ellipse-outline' },
  failed: { label: 'Linking failed', tone: 'red', icon: 'alert-circle' },
  expired: { label: 'Authorization expired', tone: 'amber', icon: 'time-outline' },
};

export interface VoiceExample {
  id: string;
  language: string;
  lines: readonly string[];
}

export const voiceExamples: readonly VoiceExample[] = [
  {
    id: 'ar',
    language: 'العربية',
    lines: ['«أليكسا، افتحي مساعد إي إم إس»', '«شغل نور غرفة النوم»', '«اطفي نور غرفة النوم»', '«هل نور غرفة النوم شغال؟»'],
  },
  {
    id: 'en',
    language: 'English',
    lines: ['“Alexa, open EMS assistant”', '“Turn on the bedroom light”', '“Turn off the bedroom light”', '“Is the bedroom light on?”'],
  },
];
