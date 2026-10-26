/**
 * EMS Voice Control: an Alexa Custom Skill (Alexa-hosted, Node.js) that
 * switches the devices registered in the customer's EMS account.
 *
 *   Alexa -> this skill -> POST {EMS_API_URL}/api/voice/command -> EMS backend
 *         -> device controller -> the physical or virtual device
 *
 * The skill authenticates every call with the EMS access token Alexa holds
 * for the customer after account linking; there is no shared token. It never
 * says a device changed unless the backend confirmed the device did.
 *
 * Intents: TurnOnIntent and TurnOffIntent (as before, now with optional
 * `device` and `room` slots), DeviceStatusIntent, and VoiceCommandIntent,
 * whose AMAZON.SearchQuery slot passes whatever was said in any dialect to
 * the backend to understand. See ../skill-package/interactionModels/custom.
 *
 * When the skill asks which action («تبي أشغل النور ولا أطفيه؟»), it
 * remembers the device for the session, so a bare «شغّله» acts on it.
 */
const Alexa = require('ask-sdk-core');

const config = require('./config');
const { postCommand } = require('./emsClient');
const { strings, forOutcome, ASKS_AGAIN } = require('./speech');

function slotValue(handlerInput, name) {
  const slot = Alexa.getSlot(handlerInput.requestEnvelope, name);
  if (!slot) {
    return undefined;
  }
  // A value matched to the slot type's catalogue is the canonical name; otherwise what was heard.
  const authorities = (slot.resolutions && slot.resolutions.resolutionsPerAuthority) || [];
  const match = authorities.find((entry) => entry.status && entry.status.code === 'ER_SUCCESS_MATCH');
  const canonical = match && match.values && match.values[0] && match.values[0].value && match.values[0].value.name;
  return canonical || slot.value || undefined;
}

function tokenOf(handlerInput) {
  const context = handlerInput.requestEnvelope.context;
  const linked = context && context.System && context.System.user && context.System.user.accessToken;
  // DEVELOPMENT ONLY fallback, empty in any skill customers use (see config.js).
  return linked || config.DEV_VOICE_TOKEN || '';
}

function linkAccount(handlerInput) {
  const s = strings(Alexa.getLocale(handlerInput.requestEnvelope));
  return handlerInput.responseBuilder.speak(s.linkRequired).withLinkAccountCard().getResponse();
}

async function runCommand(handlerInput, action, utterance) {
  const locale = Alexa.getLocale(handlerInput.requestEnvelope);
  const s = strings(locale);
  const token = tokenOf(handlerInput);
  if (!token) {
    return linkAccount(handlerInput);
  }

  const session = handlerInput.attributesManager.getSessionAttributes();
  let device = slotValue(handlerInput, 'device');
  let room = slotValue(handlerInput, 'room');
  // Answering «تبي أشغل النور ولا أطفيه؟» with just «شغّله».
  if (!utterance && !device && !room && session.pendingDevice) {
    device = session.pendingDevice.name;
    room = session.pendingDevice.room || undefined;
  }
  delete session.pendingDevice;

  let result;
  try {
    result = await postCommand(token, { action, device, room, utterance });
  } catch (error) {
    console.log(`EMS request failed: ${error.message}`);
    return handlerInput.responseBuilder.speak(s.serverDown).getResponse();
  }

  if (result.status === 401) {
    return linkAccount(handlerInput);
  }
  if (result.status !== 200 || !result.body || !result.body.ok) {
    const code = result.body && result.body.error ? result.body.error.code : 'no body';
    console.log(`EMS answered ${result.status}: ${code}`);
    return handlerInput.responseBuilder.speak(s.serverDown).getResponse();
  }

  const outcome = result.body.data;
  if (outcome.outcome === 'need_action' && outcome.device) {
    session.pendingDevice = { name: outcome.device.name, room: outcome.device.room };
  }
  handlerInput.attributesManager.setSessionAttributes(session);
  const speech = forOutcome(locale, outcome);
  if (ASKS_AGAIN.has(outcome.outcome)) {
    return handlerInput.responseBuilder.speak(speech).reprompt(speech).getResponse();
  }
  return handlerInput.responseBuilder.speak(`${speech} ${s.anythingElse}`).reprompt(s.anythingElse).getResponse();
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    const s = strings(Alexa.getLocale(handlerInput.requestEnvelope));
    return handlerInput.responseBuilder.speak(s.welcome).reprompt(s.welcomeReprompt).getResponse();
  },
};

const TurnOnIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'TurnOnIntent'
    );
  },
  handle(handlerInput) {
    return runCommand(handlerInput, 'on');
  },
};

const TurnOffIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'TurnOffIntent'
    );
  },
  handle(handlerInput) {
    return runCommand(handlerInput, 'off');
  },
};

const DeviceStatusIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'DeviceStatusIntent'
    );
  },
  handle(handlerInput) {
    return runCommand(handlerInput, 'status');
  },
};

const VoiceCommandIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'VoiceCommandIntent'
    );
  },
  handle(handlerInput) {
    const utterance = slotValue(handlerInput, 'utterance');
    if (!utterance) {
      const s = strings(Alexa.getLocale(handlerInput.requestEnvelope));
      return handlerInput.responseBuilder.speak(s.fallback).reprompt(s.fallback).getResponse();
    }
    return runCommand(handlerInput, 'auto', utterance);
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  },
  handle(handlerInput) {
    const s = strings(Alexa.getLocale(handlerInput.requestEnvelope));
    return handlerInput.responseBuilder.speak(s.help).reprompt(s.help).getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      ['AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.NoIntent'].includes(Alexa.getIntentName(handlerInput.requestEnvelope))
    );
  },
  handle(handlerInput) {
    const s = strings(Alexa.getLocale(handlerInput.requestEnvelope));
    return handlerInput.responseBuilder.speak(s.goodbye).withShouldEndSession(true).getResponse();
  },
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent'
    );
  },
  handle(handlerInput) {
    const s = strings(Alexa.getLocale(handlerInput.requestEnvelope));
    return handlerInput.responseBuilder.speak(s.fallback).reprompt(s.fallback).getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Unhandled error: ${error.message}`);
    const s = strings(Alexa.getLocale(handlerInput.requestEnvelope));
    return handlerInput.responseBuilder.speak(s.fallback).reprompt(s.fallback).getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    TurnOnIntentHandler,
    TurnOffIntentHandler,
    DeviceStatusIntentHandler,
    VoiceCommandIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .withCustomUserAgent('ems-voice-control/1.0')
  .lambda();
