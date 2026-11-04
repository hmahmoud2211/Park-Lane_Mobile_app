#!/usr/bin/env node
/**
 * Visual regression for the Expo web build, with no dependencies: headless
 * Chrome driven over the DevTools protocol (Node's built-in WebSocket) and
 * ImageMagick's `compare`.
 *
 * Every route is opened directly through the opt-in visual/<Route> addresses
 * (EXPO_PUBLIC_VISUAL_ROUTES=1, see src/navigation/AppNavigator.tsx), with the
 * clock, Math.random and crypto.getRandomValues fixed and every request that
 * leaves this machine refused, so two captures of the same code are identical.
 * For each route and viewport it writes a screenshot of the top, one scrolled
 * to the bottom, and a dump of every painted box (position, size, text, font,
 * colours), which also covers what lies below the fold.
 *
 *   # build once per state you want to compare
 *   EXPO_PUBLIC_VISUAL_ROUTES=1 EXPO_PUBLIC_DEVICE_BACKEND_URL= \
 *     EXPO_PUBLIC_ASSISTANT_URL=http://127.0.0.1:9 npx expo export -p web --output-dir /tmp/web-a
 *   node scripts/visual-regression.mjs capture --dist /tmp/web-a --out /tmp/shots-a
 *
 *   # signed-in device screens, against the stand-in hub (npm run fake-hub in the backend)
 *   ... EXPO_PUBLIC_DEVICE_BACKEND_URL=http://127.0.0.1:8797 npx expo export ...
 *   node scripts/visual-regression.mjs capture --profile ems --backend http://127.0.0.1:8797 --dist ... --out ...
 *
 *   node scripts/visual-regression.mjs compare /tmp/shots-a /tmp/shots-b
 *
 * Options: --chrome <path>, --port <n> (DevTools, default 9333), --only <Route,...>.
 */
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VIEWPORTS = [
  { id: 'phone', width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  { id: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
];

const PARKING_KEY = 'parklane.parking-demo.v1';

/**
 * The routes to capture. `path` is opened as is; `resolve` runs in the page
 * after the seed page has loaded and returns the path (for ids the demo makes).
 */
const BASIC_ROUTES = [
  { name: 'FirstScreen', path: '/' },
  { name: 'Login', path: '/visual/Login' },
  { name: 'Home', path: '/visual/Home' },
  { name: 'Profile', path: '/visual/Profile' },
  { name: 'MyUnit', path: '/visual/MyUnit' },
  { name: 'VisitorAccess', path: '/visual/VisitorAccess' },
  { name: 'Maintenance', path: '/visual/Maintenance' },
  { name: 'Community', path: '/visual/Community' },
  { name: 'SmartHome', path: '/visual/SmartHome' },
  { name: 'AmenitiesBooking', path: '/visual/AmenitiesBooking' },
  { name: 'Services', path: '/visual/Services' },
  { name: 'Settings', path: '/visual/Settings' },
  { name: 'Assistant', path: '/visual/Assistant' },
  { name: 'UnderDevelopment', path: '/visual/UnderDevelopment?title=Contact%20Us&iconSet=ionicons&iconName=call-outline' },
  { name: 'EmsDevices', path: '/visual/EmsDevices' },
  { name: 'DeviceDetail', path: '/visual/DeviceDetail?deviceId=missing' },
  { name: 'ConnectAccount', path: '/visual/ConnectAccount' },
  { name: 'GatewaySetup', path: '/visual/GatewaySetup' },
  { name: 'AddDevice', path: '/visual/AddDevice' },
  { name: 'AddDeviceMethod', path: '/visual/AddDeviceMethod?brandId=lg' },
  { name: 'DeviceDiscovery', path: '/visual/DeviceDiscovery?brandId=shelly' },
  { name: 'DeviceProvisioning', path: '/visual/DeviceProvisioning?brandId=shelly&pluginId=shelly_softap' },
  { name: 'DeviceSetup', path: '/visual/DeviceSetup?deviceId=missing' },
  { name: 'LgPairing', path: '/visual/LgPairing' },
  { name: 'AcControl', path: '/visual/AcControl?deviceId=missing' },
  { name: 'Parking', path: '/parking' },
  { name: 'ReserveParking', path: '/parking/reserve?mode=create' },
  { name: 'ReservationHistory', path: '/parking/history' },
  { name: 'SecurityConsole', path: '/parking/security' },
  { name: 'DemoControls', path: '/parking/demo' },
  {
    name: 'ReservationDetails',
    resolve: `(() => {
      const db = JSON.parse(localStorage.getItem(${JSON.stringify(PARKING_KEY)}));
      const r = db.reservations.find((x) => x.residentId === 'res-ahmed' && x.status !== 'cancelled') ?? db.reservations[0];
      return '/parking/reservation/' + encodeURIComponent(r.id);
    })()`,
  },
  {
    name: 'ParkingMap',
    resolve: `(() => {
      const db = JSON.parse(localStorage.getItem(${JSON.stringify(PARKING_KEY)}));
      const r = db.reservations.find((x) => x.residentId === 'res-ahmed' && x.status === 'confirmed') ?? db.reservations[0];
      return '/parking/map?reservationId=' + encodeURIComponent(r.id);
    })()`,
  },
  {
    name: 'ChargingSession',
    resolve: `(() => {
      const db = JSON.parse(localStorage.getItem(${JSON.stringify(PARKING_KEY)}));
      const r = db.reservations.find((x) => x.chargingAllocationId) ?? db.reservations[0];
      return '/parking/charging/' + encodeURIComponent(r.id);
    })()`,
  },
  {
    name: 'GuestPass',
    resolve: `(() => {
      const db = JSON.parse(localStorage.getItem(${JSON.stringify(PARKING_KEY)}));
      const invitation = db.invitations.find((x) => !x.revokedAt) ?? db.invitations[0];
      return '/pass/' + encodeURIComponent(invitation.inviteToken);
    })()`,
  },
];

/** Signed-in device screens; ids come from the backend before the run. */
const EMS_ROUTES = [
  { name: 'SmartHome', path: '/visual/SmartHome' },
  { name: 'EmsDevices', path: '/visual/EmsDevices' },
  { name: 'DeviceDetail', path: '/visual/DeviceDetail?deviceId={device}' },
  { name: 'DeviceSetup', path: '/visual/DeviceSetup?deviceId={device}' },
  { name: 'ConnectAccount', path: '/visual/ConnectAccount' },
  { name: 'AddDevice', path: '/visual/AddDevice' },
  { name: 'AddDeviceMethod', path: '/visual/AddDeviceMethod?brandId=switchbot' },
  { name: 'Assistant', path: '/visual/Assistant' },
];

/**
 * Runs before any page script: a clock that starts at the same instant on every
 * load (it still advances, because Animated times its animations with
 * Date.now()), and fixed "random" numbers.
 */
const DETERMINISM = `(() => {
  const FIXED = Date.UTC(2026, 9, 15, 7, 30, 0);
  const RealDate = Date;
  const started = performance.now();
  const now = () => FIXED + Math.floor(performance.now() - started);
  function FixedDate(...a) {
    if (!new.target) return new RealDate(now()).toString();
    return a.length === 0 ? new RealDate(now()) : new RealDate(...a);
  }
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = now;
  FixedDate.UTC = RealDate.UTC;
  FixedDate.parse = RealDate.parse;
  globalThis.Date = FixedDate;
  let seed = 0x2f6b1d;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = next;
  if (globalThis.crypto) {
    const fill = (array) => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
      return array;
    };
    try { Object.defineProperty(globalThis.crypto, 'getRandomValues', { value: fill, configurable: true }); } catch {}
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: () => {
          const b = fill(new Uint8Array(16));
          b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
          const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
          return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
        },
      });
    } catch {}
  }
})();`;

/** Collected in the page: every box that paints something, as sortable lines. */
const DUMP = `(() => {
  const round = (n) => Math.round(n * 2) / 2;
  const lines = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const tag = el.tagName.toLowerCase();
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.nodeValue;
    text = text.trim();
    const isSvg = el instanceof SVGElement;
    const media = isSvg || ['img', 'canvas', 'video', 'input', 'textarea', 'iframe'].includes(tag);
    const bg = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : cs.backgroundColor;
    const bgImage = cs.backgroundImage === 'none' ? '' : cs.backgroundImage.replaceAll(location.origin, '').slice(0, 160);
    const borderWidth = ['Top', 'Right', 'Bottom', 'Left'].map((s) => cs['border' + s + 'Width']).join(' ');
    const border = borderWidth === '0px 0px 0px 0px' ? '' : borderWidth + ' ' + cs.borderTopColor + ' ' + cs.borderBottomColor;
    const shadow = cs.boxShadow === 'none' ? '' : cs.boxShadow;
    const filter = cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : '';
    if (!text && !bg && !bgImage && !border && !media && !shadow && !filter) continue;
    const svg = isSvg ? [el.getAttribute('fill'), el.getAttribute('stroke'), el.getAttribute('opacity'), el.getAttribute('d')?.slice(0, 80)].join(',') : '';
    const value = tag === 'input' || tag === 'textarea' ? el.value + '|' + (el.placeholder || '') : '';
    lines.push([
      round(r.x), round(r.y), round(r.width), round(r.height), media ? tag : '', text,
      text || value ? cs.color + ' ' + cs.fontFamily + ' ' + cs.fontSize + ' ' + cs.fontWeight + ' ' + cs.lineHeight + ' ' + cs.letterSpacing + ' ' + cs.textAlign : '',
      bg, bgImage, border, border || bg ? cs.borderRadius : '', cs.opacity === '1' ? '' : cs.opacity,
      shadow, filter, cs.transform === 'none' ? '' : cs.transform, svg, value,
    ].join(' | '));
  }
  return lines.sort();
})()`;

/** The scroll container that holds most of the page, scrolled to its end. */
const SCROLL_TO_END = `(() => {
  let best = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 4) continue;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (area > bestArea) { best = el; bestArea = area; }
  }
  if (!best) return false;
  best.scrollTop = best.scrollHeight;
  return true;
})()`;

// ---------------------------------------------------------------------------

function serveDist(dist) {
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  };
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    let file = join(dist, path);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(dist, 'index.html');
    }
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launchChrome(port) {
  const chrome = option('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const profile = mkdtempSync(join(tmpdir(), 'visual-chrome-'));
  const child = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb',
    '--font-render-hinting=none', '--disable-features=Translate,OptimizationHints', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    // Software rendering, images decoded before drawing, and every compositor stage run
    // before a frame is drawn: the same pixels on every run.
    '--disable-gpu', '--disable-gpu-compositing', '--disable-checker-imaging', '--disable-partial-raster',
    '--run-all-compositor-stages-before-draw', '--disable-lcd-text', '--disable-threaded-animation',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return { child, profile, wsUrl: version.webSocketDebuggerUrl };
    } catch {
      await sleep(100);
    }
  }
  child.kill();
  throw new Error(`Chrome did not open its DevTools port ${port}`);
}

/** One browser-level connection; page sessions are multiplexed on it (flatten). */
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return { opened, send, listeners, close: () => socket.close() };
}

async function openPage(cdp, viewport, { allow, session }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const errors = [];
  const onEvent = (message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push((details.exception?.description ?? details.text ?? '').split('\n')[0]);
      return;
    }
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const url = request.url;
    if (allow.some((prefix) => url.startsWith(prefix))) {
      send('Fetch.continueRequest', { requestId }).catch(() => {});
    } else {
      send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
  };
  cdp.listeners.add(onEvent);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Emulation.setDeviceMetricsOverride', viewport);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Africa/Cairo' });
  await send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {});
  let script = DETERMINISM;
  if (session) {
    script += `\ntry { sessionStorage.setItem('ems.session', ${JSON.stringify(session)}); } catch {}`;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: script });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const navigate = async (url) => {
    const loaded = new Promise((resolve) => {
      const onLoad = (message) => {
        if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
          cdp.listeners.delete(onLoad);
          resolve();
        }
      };
      cdp.listeners.add(onLoad);
    });
    await send('Page.navigate', { url });
    await Promise.race([loaded, sleep(20000)]);
    await evaluate('document.fonts.ready.then(() => true)');
    // Settle: wait until two dumps 400 ms apart agree (animations, effects, fetch failures).
    await sleep(1200);
    let previous = '';
    for (let i = 0; i < 15; i++) {
      const current = JSON.stringify(await evaluate(DUMP));
      if (current === previous) return JSON.parse(current);
      previous = current;
      await sleep(400);
    }
    return JSON.parse(previous);
  };
  const screenshot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
  };
  const close = async () => {
    cdp.listeners.delete(onEvent);
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  };
  return { navigate, evaluate, screenshot, close, errors };
}

async function emsSetup(backend) {
  const call = async (method, path, body, token) => {
    const response = await fetch(`${backend}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await response.json();
    if (!parsed.ok) throw new Error(`${method} ${path}: ${parsed.error?.message}`);
    return parsed.data;
  };
  const login = await call('POST', '/api/auth/login', { email: 'demo@parklane.test', password: 'correct horse battery' });
  const token = login.token;
  const devices = await call('GET', '/api/devices', undefined, token);
  const list = Array.isArray(devices) ? devices : devices.devices;
  const sorted = [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { token, ids: { device: sorted[0]?.id ?? 'missing' } };
}

async function capture() {
  const dist = option('dist');
  const out = option('out');
  const profileName = option('profile', 'basic');
  if (!dist || !out) throw new Error('capture needs --dist <export dir> and --out <dir>');
  const only = option('only')?.split(',');
  const server = await serveDist(dist);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const backend = option('backend');
  let session;
  let ids = {};
  let routes = BASIC_ROUTES;
  const allow = [origin, 'data:', 'blob:'];
  if (profileName === 'ems') {
    if (!backend) throw new Error('--profile ems needs --backend <url>');
    ({ token: session, ids } = await emsSetup(backend));
    routes = EMS_ROUTES;
    allow.push(backend);
  }
  if (only) routes = routes.filter((route) => only.includes(route.name));
  const port = Number(option('port', '9333'));
  const chrome = await launchChrome(port);
  const cdp = connect(chrome.wsUrl);
  await cdp.opened;
  const failures = [];
  try {
    for (const viewport of VIEWPORTS) {
      const dir = join(out, profileName, viewport.id);
      mkdirSync(dir, { recursive: true });
      for (const route of routes) {
        const page = await openPage(cdp, viewport, { allow, session });
        try {
          let path = route.path;
          if (route.resolve) {
            await page.navigate(`${origin}/parking/history`);
            path = await page.evaluate(route.resolve);
          }
          path = path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(ids[key] ?? 'missing'));
          const dump = await page.navigate(`${origin}${path}`);
          await page.screenshot(join(dir, `${route.name}.png`));
          writeFileSync(join(dir, `${route.name}.json`), JSON.stringify({ path: path.replace(/\/(reservation|charging|pass)\/[^?]+/, '/$1/<id>').replace(/reservationId=[^&]+/, 'reservationId=<id>'), errors: page.errors, boxes: dump }, null, 1));
          if (await page.evaluate(SCROLL_TO_END)) {
            await sleep(700);
            await page.screenshot(join(dir, `${route.name}.bottom.png`));
          }
          process.stdout.write(`  ${profileName}/${viewport.id}/${route.name}  ${dump.length} boxes${page.errors.length ? `  ${page.errors.length} page error(s): ${page.errors[0]}` : ''}\n`);
        } catch (error) {
          failures.push(`${viewport.id}/${route.name}: ${error.message}`);
          process.stdout.write(`  ${profileName}/${viewport.id}/${route.name}  FAILED ${error.message}\n`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    cdp.close();
    chrome.child.kill();
    server.close();
    await sleep(300);
    rmSync(chrome.profile, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`\n${failures.length} route(s) failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function compare() {
  const [a, b] = args.slice(1);
  if (!a || !b) throw new Error('compare needs <baseline dir> <candidate dir>');
  const diffDir = join(b, '_diff');
  mkdirSync(diffDir, { recursive: true });
  let differences = 0;
  let checked = 0;
  for (const fileA of walk(a).filter((f) => !f.includes('_diff'))) {
    const rel = relative(a, fileA);
    const fileB = join(b, rel);
    checked++;
    if (!existsSync(fileB)) {
      differences++;
      console.log(`MISSING  ${rel}`);
      continue;
    }
    if (rel.endsWith('.png')) {
      const diffFile = join(diffDir, rel.replaceAll('/', '__'));
      // 0.79% fuzz is 2/255: run-to-run noise. Anything above that is a real change.
      const result = spawnSync('magick', ['compare', '-metric', 'AE', '-fuzz', '0.79%', fileA, fileB, diffFile], { encoding: 'utf8' });
      const pixels = Number.parseFloat(result.stderr);
      if (result.status === 0 && pixels === 0) {
        rmSync(diffFile, { force: true });
      } else {
        differences++;
        console.log(`PIXELS   ${rel}: ${result.stderr.trim() || `exit ${result.status}`}`);
      }
    } else if (rel.endsWith('.json')) {
      // Older captures kept the local server's origin (a random port) in image URLs.
      const read = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/http:\/\/127\.0\.0\.1:\d+/g, ''));
      const boxesA = read(fileA);
      const boxesB = read(fileB);
      const setA = new Set(boxesA.boxes);
      const setB = new Set(boxesB.boxes);
      const removed = boxesA.boxes.filter((line) => !setB.has(line));
      const added = boxesB.boxes.filter((line) => !setA.has(line));
      if (JSON.stringify(boxesA.errors) !== JSON.stringify(boxesB.errors)) {
        differences++;
        console.log(`ERRORS   ${rel}: ${JSON.stringify(boxesA.errors)} -> ${JSON.stringify(boxesB.errors)}`);
      }
      if (removed.length || added.length || boxesA.path !== boxesB.path) {
        differences++;
        console.log(`BOXES    ${rel}: -${removed.length} +${added.length}`);
        for (const line of removed.slice(0, 4)) console.log(`    - ${line.slice(0, 220)}`);
        for (const line of added.slice(0, 4)) console.log(`    + ${line.slice(0, 220)}`);
      }
    }
  }
  for (const fileB of walk(b).filter((f) => !f.includes('_diff'))) {
    if (!existsSync(join(a, relative(b, fileB)))) {
      differences++;
      console.log(`EXTRA    ${relative(b, fileB)}`);
    }
  }
  console.log(`\n${checked} files checked, ${differences} difference(s)`);
  process.exit(differences ? 1 : 0);
}

try {
  if (command === 'capture') await capture();
  else if (command === 'compare') compare();
  else {
    console.log('usage: visual-regression.mjs capture --dist <dir> --out <dir> [--profile basic|ems --backend <url>] | compare <a> <b>');
    process.exit(2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
