import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { encodeQr, qrSvgPath } from '../src/lib/qr.ts';

/**
 * The visitor page's QR encoder against fixed answers from the app's `qrcode` package (byte mode, level M): the
 * same version, mask and every module. (All 8 masks of 9 inputs, versions 1 to 10, were compared module for module
 * when this was written; these four keep it honest.)
 */
const GOLDEN = [
  { text: 'hello', version: 1, mask: 0, sha256: '99ccedcf0d82e92a63894c8b42e405a3ac50eafa33ee2ce68fa895813fdcb386' },
  { text: `plq_${'x'.repeat(32)}`, version: 3, mask: 0, sha256: 'e14f73325213ce5031749bdde585b2bfb79f5c9d0666fba470f6a6c8f0efc536' },
  { text: 'منى سعيد · EGY 7007', version: 3, mask: 6, sha256: 'f2480f3b2ea7434f3da29038769329e2f4d15b200aad075e3c5028b208872ab4' },
  { text: 'w'.repeat(200), version: 10, mask: 6, sha256: 'c4722f2ebf4d79926fe374312776e1aa1239f3a70822c98c8920920ba2193b82' },
];

test('QR codes match the reference encoder module for module', () => {
  for (const golden of GOLDEN) {
    const code = encodeQr(golden.text);
    const bits = code.modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')).join('');
    assert.deepEqual([code.version, code.mask, createHash('sha256').update(bits).digest('hex')], [golden.version, golden.mask, golden.sha256], golden.text.slice(0, 12));
  }
});

test('too long is refused; the SVG path draws only dark modules inside the quiet zone', () => {
  assert.throws(() => encodeQr('x'.repeat(214)), /Too long/);
  const code = encodeQr('hello');
  const squares = qrSvgPath(code).match(/M\d+ \d+h1v1h-1z/g) ?? [];
  assert.equal(squares.length, code.modules.flat().filter(Boolean).length);
  assert.ok(squares.every((square) => Number(square.slice(1).split(' ')[0]) >= 4));
});
