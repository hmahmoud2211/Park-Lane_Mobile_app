/**
 * Recognising an LG appliance's setup hotspot, its password, and the QR code
 * on the appliance's label. No React Native imports, so Node's tests run it.
 */

/** Hotspots are named LGE_<type>_<suffix> or LGE_AC-12-34-56, or [LG_<name>]<suffix> on some firmware. */
const SSID_PREFIXES = ['LGE_', '[LG_'];

/** The default for older Wi-Fi modules (LGE_AC, LGE_AC-12-34-56), as Pen Test Partners documented it. */
const MODULE_DEFAULT_PASSWORD = 'lge12345';

export function isLgHotspot(ssid: string | null | undefined): boolean {
  return Boolean(ssid && SSID_PREFIXES.some((prefix) => ssid.toUpperCase().startsWith(prefix)));
}

/**
 * The hotspot's password as LG and rethink document it: LGE_AC2_1234 uses
 * its suffix twice (12341234), a suffix of "open" means no password (null),
 * the bracketed names use 1111122222, and other LGE_ names the module
 * default. A guess either way, so the resident can change it.
 */
export function lgHotspotPassword(ssid: string): string | null {
  if (ssid.startsWith('[LG_')) {
    return '1111122222';
  }
  const suffix = /^LGE_[^_]+_([^_]+)$/i.exec(ssid)?.[1];
  if (suffix?.toLowerCase() === 'open') {
    return null;
  }
  // WPA2 needs at least 8 characters.
  if (suffix && suffix.length >= 4) {
    return suffix + suffix;
  }
  return MODULE_DEFAULT_PASSWORD;
}

export interface LgQrCode {
  /** An LG ThinQ product code (http://thinq.link/QR1?s=<serial>&m=<model>), as on AC labels. */
  thinq: boolean;
  /** The setup hotspot's name, when the code carries it. */
  ssid: string | null;
  /** The hotspot's password: absent (undefined) unless the code carries it; null for an open network. */
  password?: string | null;
  /** The appliance's MAC address as 12 hex digits; hotspot names often end in part of it. */
  mac: string | null;
  /** LG's model code without its regional suffix, e.g. S4NW24K2RME. */
  model: string | null;
  serial: string | null;
  /** The text the code holds, to show when nothing in it was recognised. */
  raw: string;
}

/** LG's label codes link to thinq.link, with the serial in `s` and the model in `m`. */
const THINQ_LINK = /^https?:\/\/(?:[\w-]+\.)*thinq\.link\//i;

const SSID_IN_TEXT = /(\[LG_[^\]]+\][A-Za-z0-9]*|LGE_[A-Za-z0-9_-]+)/;
const MAC_IN_TEXT = /(?:^|[^0-9A-Fa-f])((?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{12})(?![0-9A-Fa-f])/;

const FIELD_NAMES = {
  ssid: ['ssid', 'apssid', 'ap', 'wifi'],
  password: ['pw', 'pwd', 'pass', 'password', 'appw', 'key', 'psk'],
  mac: ['mac', 'macaddr', 'macaddress', 'wifimac'],
  model: ['model', 'modelname', 'mdl', 'modelcode'],
  serial: ['sn', 'serial', 'serialno', 'serialnumber'],
} as const;

/** The standard Wi-Fi QR format: WIFI:T:WPA;S:<name>;P:<password>;; with \ escapes. */
function parseWifiQr(raw: string): Map<string, string> | null {
  if (!/^WIFI:/i.test(raw)) {
    return null;
  }
  const fields = new Map<string, string>();
  let key = '';
  let value = '';
  let inValue = false;
  for (let i = 5; i < raw.length; i++) {
    const char = raw[i];
    if (char === '\\' && i + 1 < raw.length) {
      value += raw[++i];
    } else if (!inValue && char === ':') {
      inValue = true;
    } else if (char === ';') {
      if (key) {
        fields.set(key.toUpperCase(), value);
      }
      key = '';
      value = '';
      inValue = false;
    } else if (inValue) {
      value += char;
    } else {
      key += char;
    }
  }
  return fields;
}

/** Query parameters or a JSON object's top-level strings, by lower-cased name. */
function namedFields(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      for (const [name, value] of Object.entries(JSON.parse(text) as Record<string, unknown>)) {
        if (typeof value === 'string' || typeof value === 'number') {
          fields.set(name.toLowerCase(), String(value));
        }
      }
    } catch {
      // Not JSON after all.
    }
    return fields;
  }
  const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text;
  for (const pair of query.split(/[&;]/)) {
    const at = pair.indexOf('=');
    if (at <= 0) {
      continue;
    }
    try {
      fields.set(decodeURIComponent(pair.slice(0, at)).toLowerCase(), decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' ')));
    } catch {
      // A malformed escape: skip this pair.
    }
  }
  return fields;
}

const pick = (fields: Map<string, string>, names: readonly string[]) =>
  names.map((name) => fields.get(name)).find((value) => value !== undefined && value !== '') ?? null;

/**
 * Reads the QR code on an LG appliance's label. LG does not document what it
 * holds, so this takes what it can from the common shapes: a standard Wi-Fi
 * code, a link or JSON with named fields, or an LGE_ name or MAC address
 * anywhere in the text.
 */
export function parseLgQrCode(raw: string): LgQrCode {
  const wifi = parseWifiQr(raw);
  if (wifi) {
    const ssid = wifi.get('S') || null;
    const open = (wifi.get('T') ?? '').toLowerCase() === 'nopass';
    return {
      thinq: false,
      ssid,
      ...(open ? { password: null } : wifi.has('P') ? { password: wifi.get('P') } : {}),
      mac: null,
      model: null,
      serial: null,
      raw,
    };
  }

  const fields = namedFields(raw);
  const thinq = THINQ_LINK.test(raw.trim());
  if (thinq) {
    // Short names there; `s` would otherwise read as nothing, and `m` is the model.
    fields.set('serial', fields.get('s') ?? '');
    fields.set('model', fields.get('m') ?? '');
  }
  const named = pick(fields, FIELD_NAMES.ssid);
  const ssid = named && isLgHotspot(named) ? named : (SSID_IN_TEXT.exec(raw)?.[1] ?? null);
  const password = pick(fields, FIELD_NAMES.password);
  // A ThinQ link's serial can look like a MAC address; only a named field counts there.
  const macText = pick(fields, FIELD_NAMES.mac) ?? (thinq ? null : (MAC_IN_TEXT.exec(raw)?.[1] ?? null));
  const mac = macText?.replace(/[:-]/g, '').toUpperCase() ?? null;
  return {
    thinq,
    ssid,
    ...(password !== null ? { password } : {}),
    mac: mac && /^[0-9A-F]{12}$/.test(mac) ? mac : null,
    // S4NW24K2RME.AS6GEEG: the part after the dot is the regional suffix.
    model: pick(fields, FIELD_NAMES.model)?.split('.')[0] || null,
    serial: pick(fields, FIELD_NAMES.serial),
    raw,
  };
}

/** True when the code identifies an LG appliance, even if it does not name its hotspot. */
export const isLgApplianceCode = (code: LgQrCode) => code.thinq || code.ssid !== null || code.mac !== null;

const alphanumeric = (text: string) => text.toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * The hotspot a scanned code points to, among the LG hotspots in range: the
 * name the code carries; else the one whose name ends in the end of the
 * code's MAC address (LGE_AC-12-34-56 style names) or of its serial; else,
 * for an LG appliance's code, the only LG hotspot in range, as LG's app
 * does. Null when that does not settle it.
 */
export function hotspotForQrCode(code: LgQrCode, nearby: readonly { ssid: string }[]): string | null {
  if (code.ssid) {
    return code.ssid;
  }
  const candidates = nearby.filter((hotspot) => isLgHotspot(hotspot.ssid));
  const endingIn = (tail: string) => {
    const matches = candidates.filter((hotspot) => alphanumeric(hotspot.ssid).endsWith(tail));
    return matches.length === 1 ? matches[0].ssid : null;
  };
  const byMac = code.mac ? endingIn(code.mac.slice(-6)) : null;
  if (byMac) {
    return byMac;
  }
  const serial = code.serial ? alphanumeric(code.serial) : '';
  const bySerial = serial.length >= 4 ? endingIn(serial.slice(-4)) : null;
  if (bySerial) {
    return bySerial;
  }
  return isLgApplianceCode(code) && candidates.length === 1 ? candidates[0].ssid : null;
}
