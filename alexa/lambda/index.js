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
 * `device` and `room` slots), plus DeviceStatusIntent. See
 * ../skill-package/interactionModels/custom for the models.
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
  const match = slot.resolutions?.resolutionsPerAuthority?.find((entry) => entry.status?.code === 'ER_SUCCESS_MATCH');
  return match?.values?.[0]?.value?.name || slot.value || undefined;
}

function tokenOf(handlerInput) {
  const linked = handlerInput.requestEnvelope.context?.System?.user?.accessToken;
  // DEVELOPMENT ONLY fallback, empty in any skill customers use (see config.js).
  return linked || config.DEV_VOICE_TOKEN || '';
}

function linkAccount(handlerInput) {
  const s = strings(Alexa.getLocale(handlerInput.requestEnvelope));
  return handlerInput.responseBuilder.speak(s.linkRequired).withLinkAccountCard().getResponse();
}

async function runCommand(handlerInput, action) {
  const locale = Alexa.getLocale(handlerInput.requestEnvelope);
  const s = strings(locale);
  const token = tokenOf(handlerInput);
  if (!token) {
    return linkAccount(handlerInput);
  }

  let result;
  try {
    result = await postCommand(token, {
      action,
      device: slotValue(handlerInput, 'device'),
      room: slotValue(handlerInput, 'room'),
    });
  } catch (error) {
    console.log(`EMS request failed: ${error.message}`);
    return handlerInput.responseBuilder.speak(s.serverDown).getResponse();
  }

  if (result.status === 401) {
    return linkAccount(handlerInput);
  }
  if (result.status !== 200 || !result.body?.ok) {
    console.log(`EMS answered ${result.status}: ${result.body?.error?.code ?? 'no body'}`);
    return handlerInput.responseBuilder.speak(s.serverDown).getResponse();
  }

  const outcome = result.body.data;
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
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .withCustomUserAgent('ems-voice-control/1.0')
  .lambda();
