/**
 * What the skill says, in Arabic (ar-SA) and English (en-US). Every reply
 * follows the backend's outcome: success is only spoken when the device
 * itself confirmed the new state.
 */

function deviceLabel(device, lang) {
  if (!device) {
    return '';
  }
  if (!device.room) {
    return device.name;
  }
  return lang === 'ar' ? `${device.name} في ${device.room}` : `${device.name} in the ${device.room}`;
}

function list(names, lang) {
  if (names.length <= 1) {
    return names.join('');
  }
  const head = names.slice(0, -1).join(lang === 'ar' ? '، ' : ', ');
  return lang === 'ar' ? `${head} أو ${names[names.length - 1]}` : `${head}, or ${names[names.length - 1]}`;
}

const ar = {
  welcome: 'أهلاً بك في مساعد إي إم إس. كيف أقدر أساعدك؟',
  welcomeReprompt: 'تقدر تقول: شغل نور غرفة النوم، أو اطفي النور.',
  help: 'أقدر أشغل وأطفي أجهزتك المسجلة في تطبيق إي إم إس. قل مثلاً: شغل نور غرفة النوم، أو هل المكيف شغال؟',
  goodbye: 'مع السلامة.',
  fallback: 'ما فهمت عليك. قل مثلاً: شغل نور غرفة النوم.',
  anythingElse: 'تبي شي ثاني؟',
  linkRequired: 'لازم تربط حساب إي إم إس أول. افتح تطبيق إي إم إس، ثم الإعدادات، ثم أليكسا، واضغط ربط أليكسا.',
  done: (device, power) => `تم ${power === 'on' ? 'تشغيل' : 'إطفاء'} ${deviceLabel(device, 'ar')}.`,
  status: (device) =>
    !device.online
      ? `${deviceLabel(device, 'ar')} غير متصل الآن. آخر حالة معروفة: ${device.power === 'on' ? 'شغال' : device.power === 'off' ? 'طافي' : 'غير معروفة'}.`
      : `${deviceLabel(device, 'ar')} ${device.power === 'on' ? 'شغال' : device.power === 'off' ? 'طافي' : 'حالته غير معروفة'}.`,
  ambiguous: (candidates) => `عندك أكثر من جهاز بهذا الاسم: ${list(candidates.map((d) => deviceLabel(d, 'ar')), 'ar')}. أي واحد تقصد؟`,
  needDevice: (candidates) => `أي جهاز تقصد؟ عندك ${list(candidates.slice(0, 4).map((d) => deviceLabel(d, 'ar')), 'ar')}.`,
  notFound: (heard) => (heard ? `ما لقيت جهاز اسمه ${heard}.` : 'ما لقيت هذا الجهاز.') + ' تأكد من الاسم في تطبيق إي إم إس.',
  noDevices: 'ما عندك أجهزة مسموح لأليكسا تتحكم فيها. أضف جهاز في تطبيق إي إم إس واسمح لأليكسا فيه.',
  offline: (device) => `${deviceLabel(device, 'ar')} غير متصل الآن، فما قدرت أغير حالته.`,
  unreachable: (device) => `ما قدرت أوصل لـ ${deviceLabel(device, 'ar')}. ما تغيرت حالته.`,
  timeout: (device) => `${deviceLabel(device, 'ar')} ما أكد الأمر في الوقت. تأكد من حالته في التطبيق.`,
  serverDown: 'ما قدرت أتواصل مع خدمة إي إم إس الآن، فما تأكدت من تنفيذ الأمر. حاول بعد شوي.',
  virtualNote: ' هذا مفتاح افتراضي للتجربة.',
};

const en = {
  welcome: 'Welcome to EMS assistant. How can I help?',
  welcomeReprompt: 'You can say: turn on the bedroom light, or turn off the light.',
  help: 'I can switch the devices in your EMS app on and off. Try: turn on the bedroom light, or: is the air conditioner on?',
  goodbye: 'Goodbye.',
  fallback: 'Sorry, I did not get that. Try: turn on the bedroom light.',
  anythingElse: 'Anything else?',
  linkRequired: 'First link your EMS account. In the EMS app, open Settings, then Alexa, and tap Connect to Alexa.',
  done: (device, power) => `${deviceLabel(device, 'en')} is ${power === 'on' ? 'on' : 'off'}.`,
  status: (device) =>
    !device.online
      ? `${deviceLabel(device, 'en')} is offline. It was last ${device.power === 'unknown' ? 'in an unknown state' : device.power}.`
      : `${deviceLabel(device, 'en')} is ${device.power === 'unknown' ? 'in an unknown state' : device.power}.`,
  ambiguous: (candidates) => `You have more than one: ${list(candidates.map((d) => deviceLabel(d, 'en')), 'en')}. Which one?`,
  needDevice: (candidates) => `Which device? You have ${list(candidates.slice(0, 4).map((d) => deviceLabel(d, 'en')), 'en')}.`,
  notFound: (heard) => (heard ? `I couldn't find a device called ${heard}.` : "I couldn't find that device.") + ' Check its name in the EMS app.',
  noDevices: 'Alexa is not allowed to control any of your devices yet. Add one in the EMS app and allow Alexa for it.',
  offline: (device) => `${deviceLabel(device, 'en')} is offline, so I couldn't switch it.`,
  unreachable: (device) => `I couldn't reach ${deviceLabel(device, 'en')}. Nothing changed.`,
  timeout: (device) => `${deviceLabel(device, 'en')} didn't confirm in time. Check it in the app.`,
  serverDown: "I couldn't reach the EMS service, so I can't confirm anything changed. Please try again shortly.",
  virtualNote: ' That is a virtual test switch.',
};

function strings(locale) {
  return String(locale || '').toLowerCase().startsWith('ar') ? ar : en;
}

/** Speech for a backend outcome (see server/src/ems/voice.ts). */
function forOutcome(locale, result) {
  const s = strings(locale);
  switch (result.outcome) {
    case 'done':
      return s.done(result.device, result.device.power) + (result.device.simulated ? s.virtualNote : '');
    case 'status':
      return s.status(result.device);
    case 'ambiguous':
      return s.ambiguous(result.candidates);
    case 'need_device':
      return s.needDevice(result.candidates);
    case 'not_found':
      return s.notFound(result.heard);
    case 'no_devices':
      return s.noDevices;
    case 'offline':
      return s.offline(result.device);
    case 'unreachable':
      return s.unreachable(result.device);
    case 'timeout':
      return s.timeout(result.device);
    default:
      return s.serverDown;
  }
}

/** Outcomes after which the skill waits for the customer to name a device. */
const ASKS_AGAIN = new Set(['ambiguous', 'need_device', 'not_found']);

module.exports = { strings, forOutcome, ASKS_AGAIN };
