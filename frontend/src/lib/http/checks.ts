/**
 * Behaviour checks for the app's HTTP clients (EMS backend, CUBE gateway, Parklane
 * Assistant, devices on their setup hotspots), against a stubbed fetch and clock:
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
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'unauthorized', message: 'Sign in to your EMS account first.' });
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
      message: 'Could not reach the EMS backend. Check your internet connection.',
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
    await rejects(pending, { class: 'EmsError', code: 'timeout', message: 'The EMS backend took too long to answer.' });
  });

  check('EMS: the timeout covers reading the body', async () => {
    ems.setSessionToken('tok');
    handler = hangBody;
    fakeTimers();
    const pending = ems.call('/api/home');
    await tick();
    fireTimers();
    realTimers();
    await rejects(pending, { class: 'EmsError', code: 'internal', message: 'The EMS backend answered 200.', status: 200 });
  });

  check('EMS: a body that is not an envelope', async () => {
    ems.setSessionToken('tok');
    handler = async () => text('<html>Bad gateway</html>', 502);
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'internal', message: 'The EMS backend answered 502.', status: 502 });
    handler = async () => json(5, 200);
    await rejects(ems.call('/api/home'), { class: 'EmsError', code: 'internal', message: 'The EMS backend answered 200.', status: 200 });
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
      message: 'Could not reach the gateway.',
      recovery: 'Check that it is running and that your phone is on the same network, or use its remote address.',
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
      message: 'The gateway took too long to answer.',
      recovery: 'Check that it is running and that your phone is on the same network.',
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
    await rejects(gateway.gatewayCall(target, '/devices'), { class: 'GatewayError', code: 'internal', message: 'The gateway answered 500.', recovery: null, status: 500 });
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
