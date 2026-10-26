/**
 * What the skill says, in Arabic (ar-SA) and English (en-US). Every reply
 * follows the backend's outcome: success is only spoken when the device
 * itself confirmed the new state.
 */

function deviceLabel(device, lang) {
  if (!device) {
    return '';
  }
  // "Kitchen Light", not "Kitchen Light in the Kitchen".
  if (!device.room || device.name.toLowerCase().includes(device.room.toLowerCase())) {
    return device.name;
  }
  return lang === 'ar' ? `${device.name} في ${device.room}` : `${device.name} in the ${device.room}`;
}

function joinAnd(names, lang) {
  if (names.length <= 1) {
    return names.join('');
  }
  const head = names.slice(0, -1).join(lang === 'ar' ? '، ' : ', ');
  return lang === 'ar' ? `${head} و${names[names.length - 1]}` : `${head} and ${names[names.length - 1]}`;
}

function list(names, lang) {
  if (names.length <= 1) {
    return names.join('');
  }
  const head = names.slice(0, -1).join(lang === 'ar' ? '، ' : ', ');
  return lang === 'ar' ? `${head} أو ${names[names.length - 1]}` : `${head}, or ${names[names.length - 1]}`;
}

const ar = {
  // As the skill greeted before the EMS integration.
  welcome: 'أهلاً بك في مساعد إي إم إس الذكي. هل تريد تشغيل النور أم إطفاءه؟',
  welcomeReprompt: 'يمكنك أن تقول شغل النور أو اطفي النور.',
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
  thanks: 'العفو، في الخدمة دايماً. مع السلامة.',
  yes: 'تفضل، وش تبيني أسوي؟',
  needAction: (device) => (device ? `تبي أشغل ${deviceLabel(device, 'ar')} ولا أطفيه؟` : 'وش تبيني أسوي؟ أشغل ولا أطفي؟'),
  batch: (result) => {
    const parts = [];
    if (result.done.length > 0) {
      parts.push(`تم ${result.action === 'on' ? 'تشغيل' : 'إطفاء'} ${joinAnd(result.done.map((d) => deviceLabel(d, 'ar')), 'ar')}.`);
    }
    for (const failed of result.failed) {
      parts.push(failed.reason === 'offline' ? `${deviceLabel(failed, 'ar')} غير متصل.` : `ما قدرت أوصل لـ ${deviceLabel(failed, 'ar')}.`);
    }
    if (result.unresolved.length > 0) {
      parts.push(`وما عرفت أي جهاز تقصد بـ ${joinAnd(result.unresolved, 'ar')}.`);
    }
    return parts.join(' ');
  },
  batchStatus: (result) =>
    result.devices
      .map((d) => `${deviceLabel(d, 'ar')} ${!d.online ? 'غير متصل' : d.power === 'on' ? 'شغال' : d.power === 'off' ? 'طافي' : 'حالته غير معروفة'}`)
      .join('، ') + '.',
};

const en = {
  welcome: 'Welcome to EMS assistant. What would you like me to turn on or off?',
  welcomeReprompt: 'You can say: turn on the bedroom light, lights off, or: is the fan on?',
  help:
    'I can switch the devices in your EMS app on and off, and tell you what is on. Try: turn on the kitchen light, turn everything off, or: what is on? When you are done, just say thank you.',
  goodbye: 'Goodbye.',
  fallback: "Sorry, I didn't catch that. Try: turn on the kitchen light, or: lights off.",
  anythingElse: 'Anything else?',
  linkRequired: 'First link your EMS account. In the EMS app, open Settings, then Alexa, and tap Connect to Alexa.',
  done: (device, power) => `OK, ${deviceLabel(device, 'en')} is now ${power === 'on' ? 'on' : 'off'}.`,
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
  thanks: "You're welcome. Goodbye!",
  yes: 'Sure, what would you like me to do?',
  needAction: (device) => (device ? `Should I turn ${deviceLabel(device, 'en')} on or off?` : 'Should I turn it on or off?'),
  batch: (result) => {
    const parts = [];
    if (result.done.length > 0) {
      parts.push(`OK, I turned ${result.action} ${joinAnd(result.done.map((d) => deviceLabel(d, 'en')), 'en')}.`);
    }
    for (const failed of result.failed) {
      parts.push(failed.reason === 'offline' ? `${deviceLabel(failed, 'en')} is offline.` : `I couldn't reach ${deviceLabel(failed, 'en')}.`);
    }
    if (result.unresolved.length > 0) {
      parts.push(`I wasn't sure which device you meant by ${joinAnd(result.unresolved, 'en')}.`);
    }
    return parts.join(' ');
  },
  batchStatus: (result) =>
    result.devices
      .map((d) => `${deviceLabel(d, 'en')} is ${!d.online ? 'offline' : d.power === 'unknown' ? 'in an unknown state' : d.power}`)
      .join(', ') + '.',
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
    case 'need_action':
      return s.needAction(result.device);
    case 'batch':
      return s.batch(result);
    case 'batch_status':
      return s.batchStatus(result);
    default:
      return s.serverDown;
  }
}

/** Outcomes after which the skill waits for the customer to name a device. */
const ASKS_AGAIN = new Set(['ambiguous', 'need_device', 'not_found', 'need_action']);

module.exports = { strings, forOutcome, ASKS_AGAIN };
