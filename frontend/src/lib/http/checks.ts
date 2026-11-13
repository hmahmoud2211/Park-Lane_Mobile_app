/**
 * Behaviour checks for the app's HTTP clients (EMS backend, CUBE gateway, Parklane
 * Assistant, devices on their setup hotspots, Health Passport) and its two realtime
 * channels, against a stubbed fetch, XMLHttpRequest, WebSocket and clock:
 * what each sends, which error it throws for each failure (class, code, message,
 * status, recovery), which wins when a timeout and a cancel coincide, and who is told
 * about a refused token. Written before the clients shared a core, so the core can
 * be changed freely as long as these hold.
 *
 *   npm run check:transport
 */

process.env.EXPO_PUBLIC_DEVICE_BACKEND_URL = 'https://ems.test/';
process.env.EXPO_PUBLIC_ASSISTANT_URL = 'https://assistant.test';

async function main() {
  const ems = await import('../../features/ems/services/emsHttp');
  const gateway = await import('../../features/gateway/services/gatewayHttp');
  const assistant = await import('../../features/assistant/services/assistantApi');
  const device = await import('../../features/provisioning/services/deviceHttp');
  const health = await import('../../features/health/services/httpHealthService');
  const emsRealtime = await import('../../features/ems/services/realtime');
  const gatewayRealtime = await import('../../features/gateway/services/realtime');

  // ---- Stubs -----------------------------------------------------------------------------

  interface Sent {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
    signal: AbortSignal | undefined;
  }

  let sent: Sent[] = [];
  type Handler = (request: Sent) => Promise<unknown>;
  let handler: Handler = async () => {
    throw new Error('no handler');
  };

  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const request: Sent = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined,
      signal: init.signal ?? undefined,
    };
    sent.push(request);
    return handler(request);
  }) as typeof fetch;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const text = (body: string, status: number) => new Response(body, { status });
  /** A fetch that never settles until its signal aborts, like a server that never answers. */
  const hang: Handler = ({ signal }) =>
    new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  /** A response whose body never arrives until the signal aborts. */
  const hangBody: Handler = async ({ signal }) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))),
  });

  /** Timers the code under test sets, fired on demand instead of by the clock. */
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  function fakeTimers() {
    globalThis.setTimeout = ((callback: () => void) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => {
      timers.delete(id);
    }) as unknown as typeof clearTimeout;
  }
  function realTimers() {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    timers.clear();
  }
  function fireTimers() {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((callback) => callback());
  }
  const tick = () => new Promise((resolve) => realSetTimeout(resolve, 0));

  // ---- Assertions --------------------------------------------------------------------------

  function equal(actual: unknown, expected: unknown, what: string) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
  }

  async function rejects(promise: Promise<unknown>, expected: Record<string, unknown> & { class: string }) {
    try {
      await promise;
    } catch (error) {
      const e = error as Record<string, unknown> & { constructor: { name: string } };
      equal(e.constructor.name, expected.class, 'error class');
      for (const [key, value] of Object.entries(expected)) {
        if (key !== 'class') equal(e[key], value, key);
      }
      return;
    }
    throw new Error('expected a rejection');
  }

  const checks: [string, () => Promise<void>][] = [];
  const check = (name: string, run: () => Promise<void>) => checks.push([name, run]);

  // ---- EMS backend -------------------------------------------------------------------------

  check('EMS: refuses before sending when signed out', async () => {
    ems.setSessionToken(null);
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'unauthorized', message: 'Please sign in first.' });
    equal(sent.length, 0, 'requests sent');
  });

  check('EMS: sends the session, JSON headers and body; returns data', async () => {
    ems.setSessionToken('tok');
    handler = async () => json({ ok: true, data: { id: 1 } });
    equal(await ems.call('/api/devices/x', { method: 'PATCH', body: { name: 'Lamp' } }), { id: 1 }, 'data');
    equal(sent[0].url, 'https://ems.test/api/devices/x', 'url');
    equal(sent[0].method, 'PATCH', 'method');
    equal(sent[0].headers, { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, 'headers');
    equal(sent[0].body, '{"name":"Lamp"}', 'body');
  });

  check('EMS: GET without a body sends no Content-Type; auth:false sends no token', async () => {
    ems.setSessionToken('tok');
    handler = async () => json({ ok: true, data: null });
    await ems.call('/api/auth/login', { auth: false });
    equal(sent[0].method, 'GET', 'method');
    equal(sent[0].headers, { Accept: 'application/json' }, 'headers');
  });

  check('EMS: network failure', async () => {
    ems.setSessionToken('tok');
    handler = async () => {
      throw new TypeError('Failed to fetch');
    };
    await rejects(ems.call('/api/home'), {
      class: 'EmsError',
      code: 'network',
      message: 'Couldn’t connect. Check your internet connection and try again.',
    });
  });

  check('EMS: timeout', async () => {
    ems.setSessionToken('tok');
    handler = hang;
    fakeTimers();
    const pending = ems.call('/api/home');
    await tick();
    fireTimers();
    realTimers();
    await rejects(pending, { class: 'EmsError', code: 'timeout', message: 'This is taking too long. Check your internet connection and try again.' });
  });

  check('EMS: the timeout covers reading the body, and is reported as one', async () => {
    ems.setSessionToken('tok');
    handler = hangBody;
    fakeTimers();
    const pending = ems.call('/api/home');
    await tick();
    fireTimers();
    realTimers();
    await rejects(pending, { class: 'EmsError', code: 'timeout', message: 'This is taking too long. Check your internet connection and try again.' });
  });

  check('EMS: a body that is not an envelope', async () => {
    ems.setSessionToken('tok');
    const odd = 'Something went wrong on our side. Try again in a moment.';
    handler = async () => text('<html>Bad gateway</html>', 502);
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'internal', message: odd, status: 502 });
    handler = async () => json(5, 200);
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'internal', message: odd, status: 200 });
  });

  check('EMS: an error envelope, and a refused session tells the listeners', async () => {
    ems.setSessionToken('tok');
    let expired = 0;
    const stop = ems.onSessionExpired(() => expired++);
    handler = async () => json({ ok: false, error: { code: 'hub_offline', message: 'Hub is offline.' } }, 503);
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'hub_offline', message: 'Hub is offline.', status: 503 });
    equal(expired, 0, 'expired listeners after hub_offline');
    handler = async () => json({ ok: false, error: { code: 'unauthorized', message: 'Sign in again.' } }, 401);
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'unauthorized', message: 'Sign in again.', status: 401 });
    equal(expired, 1, 'expired listeners after unauthorized');
    await rejects(ems.call('/api/auth/login', { auth: false }), { class: 'EmsError', code: 'unauthorized', status: 401 });
    equal(expired, 1, 'expired listeners after an unauthenticated call');
    stop();
  });

  check('EMS: a refusal for a session that has since ended leaves the new one signed in', async () => {
    ems.setSessionToken('old');
    let expired = 0;
    const stop = ems.onSessionExpired(() => expired++);
    let answer: (response: Response) => void = () => undefined;
    handler = () => new Promise((resolve) => (answer = resolve));
    const pending = ems.call('/api/home');
    await tick();
    ems.setSessionToken('new');
    answer(json({ ok: false, error: { code: 'unauthorized', message: 'Sign in again.' } }, 401));
    await rejects(pending, { class: 'EmsError', code: 'unauthorized', status: 401 });
    equal(sent[0].headers.Authorization, 'Bearer old', 'sent with the session it was made for');
    equal(expired, 0, 'expired listeners');
    stop();
  });

  check('EMS: a refusal that a 401 is not about the session leaves it signed in', async () => {
    ems.setSessionToken('tok');
    let expired = 0;
    const stop = ems.onSessionExpired(() => expired++);
    handler = async () => json({ ok: false, error: { code: 'unauthorized', message: 'The current password is wrong.' } }, 401);
    await rejects(ems.call('/api/auth/change-password', { method: 'POST', body: {}, sessionCheck: false }), { class: 'EmsError', code: 'unauthorized', status: 401 });
    equal(expired, 0, 'expired listeners after a wrong current password');
    stop();
  });

  check('EMS: a call refused until the password is changed tells those listeners, and only for it', async () => {
    ems.setSessionToken('tok');
    let asked = 0;
    let expired = 0;
    const stopAsked = ems.onPasswordChangeRequired(() => asked++);
    const stopExpired = ems.onSessionExpired(() => expired++);
    handler = async () => json({ ok: false, error: { code: 'password_change_required', message: 'Choose your own password first.' } }, 403);
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'password_change_required', message: 'Choose your own password first.', status: 403 });
    equal([asked, expired], [1, 0], 'password-change and expired listeners');
    handler = async () => json({ ok: false, error: { code: 'forbidden', message: 'Owners only.' } }, 403);
    await rejects(ems.call('/api/unit/invites', { method: 'POST' }), { class: 'EmsError', code: 'forbidden', status: 403 });
    equal(asked, 1, 'password-change listeners after another 403');
    stopAsked();
    stopExpired();
  });

  check('EMS: a read marked retry tries once more after a network failure, and only then', async () => {
    ems.setSessionToken('tok');
    let attempts = 0;
    handler = async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return json({ ok: true, data: 'second time' });
    };
    equal(await ems.call('/api/home', { retry: true }), 'second time', 'data');
    equal(sent.length, 2, 'requests');
    attempts = 0;
    sent = [];
    handler = async () => {
      attempts += 1;
      throw new TypeError('Failed to fetch');
    };
    await rejects(ems.call('/api/home', { retry: true }), { class: 'EmsError', code: 'network' });
    equal(sent.length, 2, 'requests when both fail');
    sent = [];
    await rejects(ems.call('/api/rooms', { method: 'POST', body: {}, retry: true }), { class: 'EmsError', code: 'network' });
    equal(sent.length, 1, 'a POST is never retried');
    sent = [];
    handler = async () => json({ ok: false, error: { code: 'hub_offline', message: 'Hub is offline.' } }, 503);
    await rejects(ems.call('/api/home', { retry: true }), { class: 'EmsError', code: 'hub_offline' });
    equal(sent.length, 1, "the backend's own errors are not retried");
    sent = [];
    handler = async () => {
      throw new TypeError('Failed to fetch');
    };
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'network' });
    equal(sent.length, 1, 'without retry');
  });

  // ---- CUBE gateway ------------------------------------------------------------------------

  const target = { baseUrl: 'http://192.168.1.9:8686', token: 'gw-token' };

  check('Gateway: sends the token and the API prefix; returns data', async () => {
    handler = async () => json({ ok: true, data: [1, 2] });
    equal(await gateway.gatewayCall(target, '/devices'), [1, 2], 'data');
    equal(sent[0].url, 'http://192.168.1.9:8686/api/v1/devices', 'url');
    equal(sent[0].headers, { Accept: 'application/json', Authorization: 'Bearer gw-token' }, 'headers');
    await gateway.gatewayCall({ baseUrl: target.baseUrl }, '/health', { method: 'POST', body: { a: 1 } });
    equal(sent[1].headers, { Accept: 'application/json', 'Content-Type': 'application/json' }, 'public route headers');
  });

  check('Gateway: network failure and timeout carry a recovery hint', async () => {
    handler = async () => {
      throw new TypeError('Failed to fetch');
    };
    await rejects(gateway.gatewayCall(target, '/devices'), {
      class: 'GatewayError',
      code: 'network',
      message: 'Could not reach your gateway.',
      recovery: 'Check that it is switched on and your phone has internet, then try again.',
    });
    handler = hang;
    fakeTimers();
    const pending = gateway.gatewayCall(target, '/devices');
    await tick();
    fireTimers();
    realTimers();
    await rejects(pending, {
      class: 'GatewayError',
      code: 'timeout',
      message: 'Your gateway took too long to answer.',
      recovery: 'Check that it is switched on and your phone has internet, then try again.',
    });
  });

  check('Gateway: a cancel wins over a timeout', async () => {
    handler = hang;
    const controller = new AbortController();
    fakeTimers();
    const pending = gateway.gatewayCall(target, '/devices', { signal: controller.signal });
    await tick();
    fireTimers();
    controller.abort();
    realTimers();
    await rejects(pending, { class: 'GatewayError', code: 'cancelled', message: 'Stopped.', recovery: null });
  });

  check('Gateway: error envelopes; a refused token tells the listeners', async () => {
    const refused: string[] = [];
    const stop = gateway.onTokenRefused((baseUrl) => refused.push(baseUrl));
    handler = async () => json({ ok: false, error: { code: 'device_busy', message: 'Busy.', recovery: 'Wait.' } }, 409);
    await rejects(gateway.gatewayCall(target, '/devices'), { class: 'GatewayError', code: 'device_busy', message: 'Busy.', recovery: 'Wait.', status: 409 });
    handler = async () => json({ ok: false, error: { code: 'unauthorized', message: 'Who are you?' } }, 401);
    await rejects(gateway.gatewayCall(target, '/devices'), { class: 'GatewayError', code: 'unauthorized', recovery: null, status: 401 });
    equal(refused, ['http://192.168.1.9:8686'], 'refused');
    await rejects(gateway.gatewayCall({ baseUrl: target.baseUrl }, '/devices'), { class: 'GatewayError', code: 'unauthorized' });
    equal(refused.length, 1, 'refused without a token');
    handler = async () => text('nope', 500);
    await rejects(gateway.gatewayCall(target, '/devices'), {
      class: 'GatewayError',
      code: 'internal',
      message: 'Your gateway gave an answer the app didn’t understand.',
      recovery: 'Try again in a moment.',
      status: 500,
    });
    stop();
  });

  check('Gateway: errorMessage shows only the message', async () => {
    equal(gateway.errorMessage(new gateway.GatewayError('x', 'Message.', 'Recovery.')), 'Message.', 'message');
    equal(gateway.errorMessage(new Error('other')), 'Something went wrong. Try again.', 'fallback');
  });

  // ---- Parklane Assistant --------------------------------------------------------------------

  check('Assistant: posts the question and returns the answer', async () => {
    handler = async () => json({ answer: 'Hi', ok: true });
    equal(await assistant.sendChatMessage({ message: 'Hello' } as never), { answer: 'Hi', ok: true }, 'answer');
    equal(sent[0].url, 'https://assistant.test/api/v1/chat', 'url');
    equal(sent[0].method, 'POST', 'method');
  });

  check('Assistant: FastAPI errors by status', async () => {
    handler = async () => json({ detail: 'No such resident' }, 404);
    await rejects(assistant.fetchHealth(), { class: 'AssistantApiError', kind: 'not_found', message: 'No such resident', status: 404 });
    handler = async () => json({ detail: [{ msg: 'field required' }, { msg: 'too long' }] }, 422);
    await rejects(assistant.fetchHealth(), { class: 'AssistantApiError', kind: 'validation', message: 'field required; too long', status: 422 });
    handler = async () => text('oops', 500);
    await rejects(assistant.fetchHealth(), { class: 'AssistantApiError', kind: 'server', message: 'HTTP 500', status: 500 });
  });

  check('Assistant: a timeout wins over a cancel; then cancel; then network', async () => {
    handler = hang;
    const controller = new AbortController();
    fakeTimers();
    let pending = assistant.fetchHealth(controller.signal);
    await tick();
    fireTimers();
    controller.abort();
    realTimers();
    await rejects(pending, { class: 'AssistantApiError', kind: 'timeout', message: 'The assistant took too long to answer.' });
    const second = new AbortController();
    pending = assistant.fetchHealth(second.signal);
    await tick();
    second.abort();
    await rejects(pending, { class: 'AssistantApiError', kind: 'aborted', message: 'Request cancelled.' });
    handler = async () => {
      throw new TypeError('Failed to fetch');
    };
    await rejects(assistant.fetchHealth(), { class: 'AssistantApiError', kind: 'network', message: 'Could not reach the assistant.' });
  });

  // ---- Devices on their setup hotspots -------------------------------------------------------

  check('Device: JSON answers, HTTP errors and invalid JSON', async () => {
    handler = async () => json({ mac: 'aa' });
    equal(await device.deviceRequest('http://192.168.33.1/shelly', { timeoutMs: 1000 }), { mac: 'aa' }, 'answer');
    equal(sent[0].headers, { Accept: 'application/json' }, 'headers');
    handler = async () => text('', 404);
    await rejects(device.deviceRequest('http://192.168.33.1/x', { timeoutMs: 1000 }), { class: 'DeviceHttpError', kind: 'httpError', message: 'The device answered 404.', status: 404 });
    handler = async () => text('not json', 200);
    await rejects(device.deviceRequest('http://192.168.33.1/x', { timeoutMs: 1000 }), { class: 'DeviceHttpError', kind: 'invalidResponse', message: 'The device’s answer was not valid JSON.' });
  });

  check('Device: a cancel wins over a timeout; timeout; unreachable', async () => {
    handler = hang;
    const controller = new AbortController();
    fakeTimers();
    let pending = device.deviceRequest('http://10.10.7.1/x', { timeoutMs: 4000, signal: controller.signal });
    await tick();
    fireTimers();
    controller.abort();
    realTimers();
    await rejects(pending, { class: 'DeviceHttpError', kind: 'aborted', message: 'Stopped.' });
    fakeTimers();
    pending = device.deviceRequest('http://10.10.7.1/x', { timeoutMs: 4000 });
    await tick();
    fireTimers();
    realTimers();
    await rejects(pending, { class: 'DeviceHttpError', kind: 'timeout', message: 'The device did not answer in time.' });
    handler = async () => {
      throw new TypeError('Failed to fetch');
    };
    await rejects(device.deviceRequest('http://10.10.7.1/x', { timeoutMs: 4000 }), { class: 'DeviceHttpError', kind: 'unreachable', message: 'Could not reach the device on its setup network.' });
  });

  // ---- Health Passport -----------------------------------------------------------------------

  /** Headers in a fixed order: the order they were set in means nothing. */
  const sortedHeaders = (headers: Record<string, string>) => Object.fromEntries(Object.entries(headers).sort());

  let refused = 0;
  const healthClient = (options: Partial<ConstructorParameters<typeof health.HttpHealthService>[0]> = {}) => {
    refused = 0;
    return new health.HttpHealthService({
      baseUrl: 'https://health.test/',
      getToken: () => 'tok',
      getLang: () => 'ar',
      onUnauthorized: () => {
        refused += 1;
      },
      ...options,
    });
  };

  check('Health: sends the session and language; the answer is the body itself, not an envelope', async () => {
    handler = async () => json([{ id: 'p1' }]);
    equal(await healthClient().listProfiles(), [{ id: 'p1' }], 'body');
    equal(sent[0].url, 'https://health.test/health/profiles', 'url');
    equal(sent[0].method, 'GET', 'method');
    equal(sortedHeaders(sent[0].headers), { Accept: 'application/json', 'Accept-Language': 'ar', Authorization: 'Bearer tok' }, 'headers');
    equal(sent[0].body, undefined, 'body sent');
  });

  check('Health: a write sends JSON, and encodes ids; signed out sends no token', async () => {
    handler = async () => json({ id: 'a/b' });
    await healthClient({ getToken: () => null }).updateProfile('a/b', { name: 'Laila' } as never);
    equal(sent[0].url, 'https://health.test/health/profiles/a%2Fb', 'url');
    equal(sent[0].method, 'PUT', 'method');
    equal(sortedHeaders(sent[0].headers), { Accept: 'application/json', 'Accept-Language': 'ar', 'Content-Type': 'application/json' }, 'headers');
    equal(sent[0].body, '{"name":"Laila"}', 'body');
  });

  check('Health: refuses before sending without a backend address', async () => {
    await rejects(healthClient({ baseUrl: '' }).getConsent(), {
      class: 'HealthError',
      kind: 'network',
      message: 'The health backend is not configured (EXPO_PUBLIC_HEALTH_API_URL).',
    });
    equal(sent.length, 0, 'requests sent');
  });

  check('Health: each failing status is its own kind, with the backend\'s explanation', async () => {
    const service = healthClient();
    handler = async () => json({ detail: 'Too big.' }, 413);
    await rejects(service.getConsent(), { class: 'HealthError', kind: 'too_large', status: 413, detail: 'Too big.', message: 'Too big.' });
    handler = async () => json({ detail: [{ msg: 'name is required' }, { msg: 'bad date' }] }, 422);
    await rejects(service.getConsent(), { class: 'HealthError', kind: 'invalid', status: 422, detail: 'name is required; bad date' });
    handler = async () => json({ ok: false, error: { code: 'not_found', message: 'Not found.' } }, 404);
    await rejects(service.getConsent(), { class: 'HealthError', kind: 'not_found', status: 404, detail: 'Not found.' });
    handler = async () => json({ message: 'Busy.' }, 503);
    await rejects(service.getConsent(), { class: 'HealthError', kind: 'busy', status: 503, detail: 'Busy.' });
    handler = async () => text('<html>Bad gateway</html>', 502);
    await rejects(service.getConsent(), { class: 'HealthError', kind: 'server', status: 502, message: 'HTTP 502' });
    equal(refused, 0, 'session refusals');
  });

  check('Health: a 401 ends the session', async () => {
    handler = async () => json({ detail: 'Expired.' }, 401);
    await rejects(healthClient().getConsent(), { class: 'HealthError', kind: 'unauthorized', status: 401 });
    equal(refused, 1, 'session refusals');
  });

  check('Health: a summary that does not exist yet is null, one being made is its state', async () => {
    const service = healthClient();
    handler = async () => json({ detail: 'None.' }, 404);
    equal(await service.getSummary('p1', 'en'), null, '404');
    equal(sent[0].url, 'https://health.test/health/profiles/p1/summary?lang=en', 'url');
    handler = async () => json({ status: 'generating' }, 202);
    equal(await service.getSummary('p1', 'ar', 'a b'), { status: 'generating' }, '202');
    equal(sent[1].url, 'https://health.test/health/profiles/p1/summary?lang=ar&specialty=a%20b', 'url with specialty');
  });

  check('Health: a delete answered 204 resolves', async () => {
    handler = async () => new Response(null, { status: 204 });
    await healthClient().deleteDocument('d1', true);
    equal(sent[0].url, 'https://health.test/health/documents/d1?delete_items=true', 'url');
    equal(sent[0].method, 'DELETE', 'method');
  });

  check('Health: no answer is network or timeout, in the screens\' terms', async () => {
    const service = healthClient();
    handler = async () => {
      throw new TypeError('Failed to fetch');
    };
    await rejects(service.getConsent(), { class: 'HealthError', kind: 'network', message: 'No connection.' });
    handler = hang;
    fakeTimers();
    const pending = service.getConsent();
    await tick();
    fireTimers();
    realTimers();
    await rejects(pending, { class: 'HealthError', kind: 'timeout', message: 'The request timed out.' });
  });

  check('Health: the timeout covers reading the body, and is reported as one', async () => {
    handler = hangBody;
    fakeTimers();
    const pending = healthClient().getConsent();
    await tick();
    fireTimers();
    realTimers();
    await rejects(pending, { class: 'HealthError', kind: 'timeout', message: 'The request timed out.' });
  });

  check('Health: an upload refuses before sending without a backend address', async () => {
    let sentXhr = 0;
    globalThis.XMLHttpRequest = class extends FakeXhr {
      send() {
        sentXhr += 1;
      }
    } as unknown as typeof XMLHttpRequest;
    try {
      await rejects(healthClient({ baseUrl: '' }).uploadDocument('p1', { ...uploadInput, files: [] }), {
        class: 'HealthError',
        kind: 'network',
      });
      equal(sentXhr, 0, 'uploads sent');
    } finally {
      globalThis.XMLHttpRequest = realXhr;
    }
  });

  /** The parts of XMLHttpRequest an upload uses, driven by hand. */
  class FakeXhr {
    static last: FakeXhr;
    upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
    headers: Record<string, string> = {};
    method = '';
    url = '';
    timeout = 0;
    status = 0;
    responseText = '';
    form: FormData | undefined;
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(form: FormData) {
      this.form = form;
      FakeXhr.last = this;
    }
    abort() {
      this.onabort?.();
    }
    answer(status: number, body: string) {
      this.status = status;
      this.responseText = body;
      this.onload?.();
    }
  }
  const realXhr = globalThis.XMLHttpRequest;
  const uploadInput = {
    files: [{ uri: 'file:///a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 4 }],
    type: 'lab_report',
    document_date: '2026-01-02',
  } as const;
  /** Starts an upload against the fake and returns once it has been sent. */
  async function startUpload(service: ReturnType<typeof healthClient>, options?: Parameters<typeof service.uploadDocument>[2]) {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const pending = service.uploadDocument('p/1', { ...uploadInput, files: [...uploadInput.files] }, options);
    await tick();
    return { pending, xhr: FakeXhr.last };
  }

  check('Health: an upload posts the form with the session, and reports progress', async () => {
    try {
      const progress: number[] = [];
      const { pending, xhr } = await startUpload(healthClient(), { onProgress: (fraction) => progress.push(fraction) });
      equal(xhr.method, 'POST', 'method');
      equal(xhr.url, 'https://health.test/health/profiles/p%2F1/documents', 'url');
      equal(xhr.headers, { Accept: 'application/json', 'Accept-Language': 'ar', Authorization: 'Bearer tok' }, 'headers');
      equal(xhr.timeout, 120_000, 'timeout');
      equal(xhr.form?.get('type'), 'lab_report', 'type');
      equal(xhr.form?.get('document_date'), '2026-01-02', 'date');
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
      xhr.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 });
      equal(progress, [0.25], 'progress');
      xhr.answer(201, '{"id":"d1","status":"processing"}');
      equal(await pending, { id: 'd1', status: 'processing' }, 'result');
    } finally {
      globalThis.XMLHttpRequest = realXhr;
    }
  });

  check('Health: a refused upload fails as a request does, and a 401 ends the session', async () => {
    try {
      const service = healthClient();
      const first = await startUpload(service);
      first.xhr.answer(413, '{"detail":"Too big."}');
      await rejects(first.pending, { class: 'HealthError', kind: 'too_large', status: 413, detail: 'Too big.' });
      const second = await startUpload(service);
      second.xhr.answer(401, 'not json');
      await rejects(second.pending, { class: 'HealthError', kind: 'unauthorized', status: 401 });
      equal(refused, 1, 'session refusals');
    } finally {
      globalThis.XMLHttpRequest = realXhr;
    }
  });

  check('Health: an upload with no answer is network, timeout or a cancel', async () => {
    try {
      const service = healthClient();
      const network = await startUpload(service);
      network.xhr.onerror?.();
      await rejects(network.pending, { class: 'HealthError', kind: 'network', message: 'No connection.' });
      const timeout = await startUpload(service);
      timeout.xhr.ontimeout?.();
      await rejects(timeout.pending, { class: 'HealthError', kind: 'timeout', message: 'The upload timed out.' });
      const controller = new AbortController();
      const cancelled = await startUpload(service, { signal: controller.signal });
      controller.abort();
      await rejects(cancelled.pending, { class: 'HealthError', kind: 'aborted', message: 'Cancelled.' });
    } finally {
      globalThis.XMLHttpRequest = realXhr;
    }
  });

  // ---- Realtime channels -------------------------------------------------------------------

  class FakeSocket {
    static failNext = false;
    static all: FakeSocket[] = [];
    readonly url: string;
    sent: string[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string) {
      if (FakeSocket.failNext) {
        FakeSocket.failNext = false;
        throw new SyntaxError('bad url');
      }
      this.url = url;
      FakeSocket.all.push(this);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
    }
  }
  (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
  const delays: number[] = [];
  const realRandom = Math.random;
  function socketTimers() {
    fakeTimers();
    const capture = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: () => void, delay: number) => {
      delays.push(delay);
      return (capture as unknown as (cb: () => void) => number)(callback);
    }) as unknown as typeof setTimeout;
  }
  const recorder = () => {
    const log: string[] = [];
    return {
      log,
      handlers: {
        onEvent: (event: { type: string }) => log.push(`event:${event.type}`),
        onState: (state: string) => log.push(`state:${state}`),
        onRefused: () => log.push('refused'),
      },
    };
  };

  check('Realtime (EMS): authenticates, goes live, reconnects with jitter, stops when refused', async () => {
    FakeSocket.all = [];
    delays.length = 0;
    socketTimers();
    Math.random = () => 0.5;
    try {
      const { log, handlers } = recorder();
      const channel = new emsRealtime.EmsRealtime('tok', handlers);
      channel.start();
      const first = FakeSocket.all[0];
      equal(first.url, 'wss://ems.test/api/events', 'url');
      first.onopen?.();
      equal(first.sent, ['{"type":"auth","token":"tok"}'], 'auth message');
      first.onmessage?.({ data: '{"type":"ready"}' });
      first.onmessage?.({ data: 'not json' });
      first.onmessage?.({ data: '{"type":"device","device":{}}' });
      first.onclose?.();
      equal(delays, [750], 'first reconnect delay (1 s base, jitter 0.5)');
      fireTimers();
      equal(FakeSocket.all.length, 2, 'reconnected');
      FakeSocket.all[1].onclose?.();
      equal(delays, [750, 1500], 'second delay doubles');
      fireTimers();
      FakeSocket.all[2].onmessage?.({ data: '{"type":"error","code":"unauthorized"}' });
      FakeSocket.all[2].onclose?.();
      equal(delays.length, 2, 'no reconnect after a refusal');
      equal(log, [
        'state:connecting', 'state:live', 'event:ready', 'event:device', 'state:offline',
        'state:connecting', 'state:offline', 'state:connecting', 'refused', 'event:error', 'state:offline',
      ], 'what the owner heard');
    } finally {
      Math.random = realRandom;
      realTimers();
    }
  });

  check('Realtime (EMS): wake reconnects at once; restart replaces; stop closes; a refused constructor throws', async () => {
    FakeSocket.all = [];
    delays.length = 0;
    socketTimers();
    try {
      const { log, handlers } = recorder();
      const channel = new emsRealtime.EmsRealtime('tok', handlers);
      channel.start();
      FakeSocket.all[0].onclose?.();
      channel.wake();
      equal(FakeSocket.all.length, 2, 'woke without waiting');
      channel.wake();
      equal(FakeSocket.all.length, 2, 'wake leaves an open socket alone');
      channel.restart();
      equal([FakeSocket.all.length, FakeSocket.all[1].closed], [3, true], 'restart replaces it at once');
      FakeSocket.all[1].onclose?.();
      equal(FakeSocket.all.length, 3, 'the replaced socket closing changes nothing');
      channel.stop();
      equal(FakeSocket.all[1].closed, true, 'closed on stop');
      equal(log.at(-1), 'state:offline', 'offline on stop');
      FakeSocket.failNext = true;
      let threw = false;
      try {
        new emsRealtime.EmsRealtime('tok', recorder().handlers).start();
      } catch {
        threw = true;
      }
      equal(threw, true, 'the EMS channel lets a constructor error through');
    } finally {
      realTimers();
    }
  });

  check('Realtime (gateway): a refused constructor retries later; retarget moves at once', async () => {
    FakeSocket.all = [];
    delays.length = 0;
    socketTimers();
    Math.random = () => 0;
    try {
      const { handlers } = recorder();
      FakeSocket.failNext = true;
      const channel = new gatewayRealtime.GatewayRealtime('http://192.168.1.9:8686', 'gw', handlers);
      channel.start();
      equal(delays, [500], 'retry scheduled instead of throwing');
      fireTimers();
      equal(FakeSocket.all[0].url, 'ws://192.168.1.9:8686/api/v1/events', 'url');
      channel.retarget('http://192.168.1.9:8686');
      equal(FakeSocket.all.length, 1, 'same address: nothing happens');
      channel.retarget('https://relay.test/relay/v1/g/abc');
      equal(FakeSocket.all[0].closed, true, 'old socket closed');
      equal(FakeSocket.all[1].url, 'wss://relay.test/relay/v1/g/abc/api/v1/events', 'new address');
      channel.retarget('https://gw1.gw.ems-iot.test:8443');
      equal(FakeSocket.all[2].url, 'wss://gw1.gw.ems-iot.test:8443/api/v1/events', 'HTTPS name keeps its port');
    } finally {
      Math.random = realRandom;
      realTimers();
    }
  });

  // ---- Run -----------------------------------------------------------------------------------

  let failed = 0;
  for (const [index, [name, run]] of checks.entries()) {
    sent = [];
    realTimers();
    try {
      await run();
      console.log(`PASS  ${index + 1}. ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL  ${index + 1}. ${name}\n        ${(error as Error).message}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
