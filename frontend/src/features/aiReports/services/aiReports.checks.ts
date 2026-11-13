/**
 * Behaviour checks for reporting an AI answer, against a stubbed fetch: what is sent for a guest and for someone
 * signed in, that a refused session signs no one out, how long answers are cut, and which plain-words message each
 * failure gets.
 *
 *   npm run check:ai-reports
 */

process.env.EXPO_PUBLIC_DEVICE_BACKEND_URL = 'https://ems.test/';

function equal(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${what}: expected ${e}\n        got ${a}`);
  }
}

async function main() {
  const ems = await import('../../ems/services/emsHttp');
  const api = await import('./aiReportsApi');

  interface Sent {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }
  let sent: Sent[] = [];
  let answer: () => Response = () => new Response(JSON.stringify({ ok: true, data: { id: 'r1', receivedAt: '2026-11-14T08:00:00.000Z' } }));
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    sent.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
    });
    return answer();
  }) as typeof fetch;
  const authOf = (request: Sent) => Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1];

  const checks: [string, () => Promise<void> | void][] = [
    [
      'a guest sends the report with no session',
      async () => {
        ems.setSessionToken(null);
        sent = [];
        const receipt = await api.sendAiReport({ source: 'assistant', reason: 'offensive', excerpt: '  The pool is closed.  ', note: '  ' });
        equal(receipt.id, 'r1', 'receipt');
        equal([sent[0].url, sent[0].method, authOf(sent[0])], ['https://ems.test/api/ai-reports', 'POST', undefined], 'request');
        equal(sent[0].body, { source: 'assistant', reason: 'offensive', excerpt: 'The pool is closed.' }, 'body: trimmed, empty note left out');
      },
    ],
    [
      'signed in, the session goes with it',
      async () => {
        ems.setSessionToken('session-123');
        sent = [];
        await api.sendAiReport({ source: 'health_summary', reason: 'harmful', excerpt: 'Stop your medicine.', note: ' Dangerous ' });
        equal(authOf(sent[0]), 'Bearer session-123', 'authorization');
        equal(sent[0].body.note, 'Dangerous', 'note trimmed');
      },
    ],
    [
      'a refused session does not sign anyone out',
      async () => {
        ems.setSessionToken('stale');
        let signedOut = false;
        const stop = ems.onSessionExpired(() => {
          signedOut = true;
        });
        answer = () => new Response(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'Sign in again.' } }), { status: 401 });
        try {
          await api.sendAiReport({ source: 'assistant', reason: 'wrong', excerpt: 'x' }).catch(() => undefined);
        } finally {
          stop();
          answer = () => new Response(JSON.stringify({ ok: true, data: { id: 'r2', receivedAt: '' } }));
        }
        equal(signedOut, false, 'signed out');
      },
    ],
    [
      `answers longer than ${api.MAX_REPORT_EXCERPT} characters are cut with an ellipsis`,
      () => {
        equal(api.excerptOf('  short  '), 'short', 'short');
        const exact = 'a'.repeat(api.MAX_REPORT_EXCERPT);
        equal(api.excerptOf(exact), exact, 'at the limit');
        const cut = api.excerptOf('b'.repeat(api.MAX_REPORT_EXCERPT + 50));
        equal([cut.length, cut.endsWith('…')], [api.MAX_REPORT_EXCERPT, true], 'cut');
        // An emoji (two UTF-16 units) across the cut is dropped whole, never halved.
        const emoji = api.excerptOf(`${'c'.repeat(api.MAX_REPORT_EXCERPT - 2)}😀${'d'.repeat(10)}`);
        equal([emoji.length <= api.MAX_REPORT_EXCERPT, /[\uD800-\uDBFF]…$/.test(emoji)], [true, false], 'emoji');
      },
    ],
    [
      'each failure gets its plain-words message',
      () => {
        const failure = (code: string) => api.reportFailureOf(new ems.EmsError(code, ''));
        equal(
          [failure('network'), failure('timeout'), failure('rate_limited'), failure('not_configured'), failure('invalid'), api.reportFailureOf(new Error('x'))],
          ['network', 'network', 'busy', 'unavailable', 'other', 'other'],
        );
      },
    ],
  ];

  let failed = 0;
  for (const [name, check] of checks) {
    try {
      await check();
      console.log(`  ok    ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${name}\n        ${(error as Error).message}`);
    }
  }
  console.log(failed ? `\n${failed} of ${checks.length} checks failed` : `\nAll ${checks.length} checks passed`);
  if (failed) process.exit(1);
}

void main();
