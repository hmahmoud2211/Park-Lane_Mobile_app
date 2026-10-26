/**
 * Home Assistant config-flow results as the app's FlowStep: typed fields with
 * labels instead of HA's serialized schema and translation keys. Pure, so it
 * can be tested on recorded results.
 *
 * Schemas come serialized by probatio.to_field_list plus HA's selectors
 * (helpers/config_validation.py custom_serializer, helpers/selector.py).
 * Labels come from frontend/get_translations, keyed
 * component.<handler>.config.{step.<id>.{title,description,data.<field>},error.<code>,abort.<reason>,…}.
 */

export type FieldKind = 'string' | 'password' | 'email' | 'number' | 'boolean' | 'select' | 'qr' | 'constant';

export interface FlowField {
  name: string;
  /** The expandable section it sits in; its value is sent nested under that name. */
  section: string | null;
  kind: FieldKind;
  label: string;
  description: string | null;
  required: boolean;
  default: unknown;
  options: { value: string; label: string }[];
  multiple: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  multiline: boolean;
  /** A QR code's content, or a constant's value. */
  data: string | null;
}

export type FlowStepType = 'form' | 'menu' | 'external' | 'progress' | 'done' | 'abort';

export interface FlowStep {
  flowId: string;
  integration: string;
  type: FlowStepType;
  stepId: string | null;
  title: string | null;
  description: string | null;
  fields: FlowField[];
  /** Field name (or `base` for the whole form) → message. */
  errors: Record<string, string>;
  menu: { id: string; label: string }[];
  /** For `external`: the page to open, e.g. the brand's sign-in. */
  url: string | null;
  /** For `done`: the linked account (config entry). */
  accountId: string | null;
  /** For `abort` and `progress`: what to tell the resident. */
  message: string | null;
}

export interface HaFlowResult {
  type: string;
  flow_id: string;
  handler: string | string[];
  step_id?: string;
  data_schema?: unknown[];
  errors?: Record<string, string> | null;
  description_placeholders?: Record<string, unknown> | null;
  menu_options?: string[] | Record<string, string>;
  url?: string;
  reason?: string;
  progress_action?: string;
  title?: string;
  result?: { entry_id?: string };
}

export type Translations = Record<string, string>;

type Serialized = Record<string, unknown> & { name?: string };

const humanize = (name: string) => name.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());

function fill(text: string | undefined, placeholders: Record<string, unknown> | null | undefined): string | null {
  if (!text) {
    return null;
  }
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    placeholders && key in placeholders && placeholders[key] !== null ? String(placeholders[key]) : match,
  );
}

function options(raw: unknown): { value: string; label: string }[] {
  if (Array.isArray(raw)) {
    return raw.map((option) => {
      if (Array.isArray(option)) return { value: String(option[0]), label: String(option[1] ?? option[0]) };
      if (option && typeof option === 'object') {
        const entry = option as { value?: unknown; label?: unknown };
        return { value: String(entry.value), label: String(entry.label ?? entry.value) };
      }
      return { value: String(option), label: humanize(String(option)) };
    });
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([value, label]) => ({ value, label: String(label) }));
  }
  return [];
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function field(serialized: Serialized, section: string | null, label: (name: string) => string, description: (name: string) => string | null): FlowField {
  const name = String(serialized.name);
  const base: FlowField = {
    name,
    section,
    kind: 'string',
    label: label(name),
    description: description(name),
    required: serialized.required === true,
    default: serialized.default ?? (serialized.description as { suggested_value?: unknown } | undefined)?.suggested_value,
    options: [],
    multiple: false,
    min: null,
    max: null,
    step: null,
    multiline: false,
    data: null,
  };
  const selector = serialized.selector as Record<string, Record<string, unknown> | null> | undefined;
  if (selector) {
    const [type, settings] = Object.entries(selector)[0] ?? ['text', {}];
    const cfg = settings ?? {};
    switch (type) {
      case 'text':
        return {
          ...base,
          kind: cfg.type === 'password' ? 'password' : cfg.type === 'email' ? 'email' : 'string',
          multiline: cfg.multiline === true,
        };
      case 'number':
        return { ...base, kind: 'number', min: num(cfg.min), max: num(cfg.max), step: num(cfg.step) };
      case 'boolean':
        return { ...base, kind: 'boolean' };
      case 'select':
        return { ...base, kind: 'select', options: options(cfg.options), multiple: cfg.multiple === true };
      case 'qr_code':
        return { ...base, kind: 'qr', required: false, data: typeof cfg.data === 'string' ? cfg.data : null };
      case 'constant':
        return { ...base, kind: 'constant', data: cfg.label !== undefined ? String(cfg.label) : String(cfg.value ?? '') };
      default:
        return base;
    }
  }
  switch (serialized.type) {
    case 'integer':
    case 'float':
      return { ...base, kind: 'number', min: num(serialized.valueMin), max: num(serialized.valueMax), step: serialized.type === 'integer' ? 1 : null };
    case 'boolean':
      return { ...base, kind: 'boolean' };
    case 'select':
      return { ...base, kind: 'select', options: options(serialized.options) };
    case 'multi_select':
      return { ...base, kind: 'select', options: options(serialized.options), multiple: true };
    case 'constant':
      return { ...base, kind: 'constant', data: String(serialized.value ?? '') };
    default:
      return base;
  }
}

export function toFlowStep(result: HaFlowResult, translations: Translations): FlowStep {
  const handler = Array.isArray(result.handler) ? String(result.handler[0]) : result.handler;
  const prefix = `component.${handler}.config`;
  const stepKey = `${prefix}.step.${result.step_id ?? ''}`;
  const placeholders = result.description_placeholders;
  const t = (key: string) => fill(translations[key], placeholders);

  const step: FlowStep = {
    flowId: result.flow_id,
    integration: handler,
    type: 'form',
    stepId: result.step_id ?? null,
    title: t(`${stepKey}.title`),
    description: t(`${stepKey}.description`),
    fields: [],
    errors: {},
    menu: [],
    url: null,
    accountId: null,
    message: null,
  };

  switch (result.type) {
    case 'form': {
      const fields: FlowField[] = [];
      for (const entry of (result.data_schema ?? []) as Serialized[]) {
        if (entry.type === 'expandable' && Array.isArray(entry.schema)) {
          const section = String(entry.name);
          for (const inner of entry.schema as Serialized[]) {
            fields.push(
              field(
                inner,
                section,
                (name) => t(`${stepKey}.sections.${section}.data.${name}`) ?? t(`${stepKey}.data.${name}`) ?? humanize(name),
                (name) => t(`${stepKey}.sections.${section}.data_description.${name}`),
              ),
            );
          }
        } else {
          fields.push(field(entry, null, (name) => t(`${stepKey}.data.${name}`) ?? humanize(name), (name) => t(`${stepKey}.data_description.${name}`)));
        }
      }
      const errors = Object.fromEntries(
        Object.entries(result.errors ?? {}).map(([name, code]) => [name, t(`${prefix}.error.${code}`) ?? humanize(code)]),
      );
      return { ...step, fields, errors };
    }
    case 'menu': {
      const raw = result.menu_options ?? [];
      const menu = Array.isArray(raw)
        ? raw.map((id) => ({ id, label: t(`${stepKey}.menu_options.${id}`) ?? humanize(id) }))
        : Object.entries(raw).map(([id, label]) => ({ id, label: t(`${stepKey}.menu_options.${id}`) ?? label }));
      return { ...step, type: 'menu', menu };
    }
    case 'external':
      return { ...step, type: 'external', url: result.url ?? null };
    case 'progress':
      return {
        ...step,
        type: 'progress',
        message: result.progress_action ? t(`${prefix}.progress.${result.progress_action}`) : null,
      };
    case 'create_entry':
      return { ...step, type: 'done', title: result.title ?? null, accountId: result.result?.entry_id ?? null };
    case 'abort':
    default: {
      const reason = result.reason ?? 'unknown';
      return { ...step, type: 'abort', message: t(`${prefix}.abort.${reason}`) ?? humanize(reason) };
    }
  }
}

/** The app sends a flat object; fields in a section go back nested, as HA expects. */
export function nestSections(data: Record<string, unknown>, fields: readonly { name: string; section: string | null }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const sectionOf = new Map(fields.map((entry) => [entry.name, entry.section]));
  for (const [name, value] of Object.entries(data)) {
    const section = sectionOf.get(name);
    if (section) {
      out[section] = { ...((out[section] as Record<string, unknown>) ?? {}), [name]: value };
    } else {
      out[name] = value;
    }
  }
  return out;
}
