import { config } from '../config.ts';
import { db } from '../ems/db.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { nestSections, toFlowStep, type FlowField, type FlowStep, type HaFlowResult, type Translations } from './flows.ts';
import { haRest, restMessage, type RestResult } from './haRest.ts';
import { hubCredentials, runtimeForUser, type HubRuntime } from './hubs.ts';
import { findIntegration, isAvailable } from './integrations.ts';

/**
 * Linking a resident's brand accounts (Tuya, SmartThings, …) to their unit's
 * Home Assistant, and managing the accounts once linked. Each link is a HA
 * config flow; the backend runs it on the resident's own hub, only for the
 * curated integrations, and remembers which resident started which flow so
 * nobody can drive someone else's.
 *
 * Brands that sign in through a browser come back to one fixed address,
 * PUBLIC_URL/api/accounts/oauth/auth/external/callback. Its `state` is the
 * hub's own signed token; the flow id inside it says which hub to forward
 * the callback to, and the hub checks the signature.
 */

const SESSION_TTL_MS = 30 * 60_000;
const FLOW_PATH = '/api/config/config_entries/flow';

interface SessionRow {
  flow_id: string;
  hub_id: string;
  user_id: string;
  handler: string;
  fields: string | null;
}

function saveSession(flowId: string, hubId: string, userId: string, handler: string) {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO pairing_sessions (flow_id, hub_id, user_id, handler, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(flow_id) DO UPDATE SET expires_at = excluded.expires_at`,
    )
    .run(flowId, hubId, userId, handler, now, now + SESSION_TTL_MS);
  db().prepare('DELETE FROM pairing_sessions WHERE expires_at < ?').run(now);
}

function sessionFor(userId: string, flowId: string): SessionRow {
  const row = db()
    .prepare('SELECT flow_id, hub_id, user_id, handler, fields FROM pairing_sessions WHERE flow_id = ? AND expires_at > ?')
    .get(flowId, Date.now()) as SessionRow | undefined;
  if (!row || row.user_id !== userId) {
    throw new ApiError('flow_expired', 'This sign-in has expired. Start again.');
  }
  return row;
}

const endSession = (flowId: string) => db().prepare('DELETE FROM pairing_sessions WHERE flow_id = ?').run(flowId);

// ---- Labels --------------------------------------------------------------------------------

const translationCache = new Map<string, Translations>();

async function translationsFor(runtime: HubRuntime, handler: string): Promise<Translations> {
  const key = `${runtime.hubId}:${handler}`;
  const cached = translationCache.get(key);
  if (cached) {
    return cached;
  }
  try {
    const { resources } = await runtime.connection.command<{ resources: Translations }>({
      type: 'frontend/get_translations',
      language: 'en',
      category: 'config',
      integration: [handler],
      config_flow: true,
    });
    translationCache.set(key, resources);
    return resources;
  } catch (error) {
    // Unlabelled fields still work: their names are humanized.
    log.warn('Could not load flow labels', { handler, reason: (error as Error).message });
    return {};
  }
}

// ---- Flows ---------------------------------------------------------------------------------

function flowResult(result: RestResult): HaFlowResult {
  if (result.status === 404) {
    throw new ApiError('flow_expired', 'This sign-in has expired. Start again.');
  }
  if (result.status === 400) {
    // HA's own schema check, e.g. "User input malformed: expected int for dictionary value @ data['pin']".
    throw new ApiError('bad_request', restMessage(result, 'Check the details you entered.'));
  }
  if (result.status >= 400) {
    throw new ApiError('ha_rejected', restMessage(result, 'Your home hub could not continue the sign-in.'));
  }
  return result.body as HaFlowResult;
}

/**
 * The step to show the app. Steps the resident has nothing to do in (a
 * finished browser sign-in or background job) are continued here.
 */
async function present(runtime: HubRuntime, userId: string, first: HaFlowResult): Promise<FlowStep> {
  let result = first;
  for (let hops = 0; hops < 3 && (result.type === 'external_done' || result.type === 'progress_done'); hops += 1) {
    result = flowResult(await haRest(runtime.hubId, 'POST', `${FLOW_PATH}/${encodeURIComponent(result.flow_id)}`, {}));
  }
  const handler = Array.isArray(result.handler) ? String(result.handler[0]) : result.handler;
  const step = toFlowStep(result, await translationsFor(runtime, handler));
  if (step.type === 'done' || step.type === 'abort') {
    endSession(step.flowId);
  } else {
    saveSession(step.flowId, runtime.hubId, userId, handler);
    const fields = JSON.stringify(step.fields.map((field) => ({ name: field.name, section: field.section })));
    db().prepare('UPDATE pairing_sessions SET fields = ? WHERE flow_id = ?').run(fields, step.flowId);
  }
  return step;
}

export async function startFlow(userId: string, integrationId: unknown): Promise<FlowStep> {
  const integration = typeof integrationId === 'string' ? findIntegration(integrationId) : undefined;
  if (!integration) {
    throw new ApiError('bad_request', 'Pick one of the brands the app lists.');
  }
  if (!isAvailable(integration)) {
    throw new ApiError('not_available', `${integration.name} cannot be linked yet. Building management has to enable it first.`);
  }
  const runtime = runtimeForUser(userId);
  const result = await haRest(runtime.hubId, 'POST', FLOW_PATH, { handler: integration.id, show_advanced_options: false });
  if (result.status === 404) {
    throw new ApiError('not_available', `${integration.name} is not available on your home hub.`);
  }
  return present(runtime, userId, flowResult(result));
}

export async function getFlow(userId: string, flowId: string): Promise<FlowStep> {
  const session = sessionFor(userId, flowId);
  const runtime = runtimeForUser(userId);
  try {
    return await present(runtime, userId, flowResult(await haRest(session.hub_id, 'GET', `${FLOW_PATH}/${encodeURIComponent(flowId)}`)));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'flow_expired') endSession(flowId);
    throw error;
  }
}

export async function stepFlow(userId: string, flowId: string, dataInput: unknown): Promise<FlowStep> {
  const session = sessionFor(userId, flowId);
  if (dataInput !== undefined && (typeof dataInput !== 'object' || dataInput === null || Array.isArray(dataInput))) {
    throw new ApiError('bad_request', 'data must be an object of field values.');
  }
  const fields = (session.fields ? JSON.parse(session.fields) : []) as Pick<FlowField, 'name' | 'section'>[];
  const body = nestSections((dataInput ?? {}) as Record<string, unknown>, fields);
  const runtime = runtimeForUser(userId);
  try {
    return await present(runtime, userId, flowResult(await haRest(session.hub_id, 'POST', `${FLOW_PATH}/${encodeURIComponent(flowId)}`, body)));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'flow_expired') endSession(flowId);
    throw error;
  }
}

export async function cancelFlow(userId: string, flowId: string): Promise<void> {
  const session = sessionFor(userId, flowId);
  await haRest(session.hub_id, 'DELETE', `${FLOW_PATH}/${encodeURIComponent(flowId)}`).catch(() => undefined);
  endSession(flowId);
}

/** The flow id in a hub's OAuth state token (a JWT; the hub verifies it, this only routes). */
function flowIdFromState(state: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(state.split('.')[1] ?? '', 'base64url').toString('utf8')) as { flow_id?: unknown };
    return typeof payload.flow_id === 'string' ? payload.flow_id : null;
  } catch {
    return null;
  }
}

/** GET PUBLIC_URL/api/accounts/oauth/auth/external/callback: forward to the hub, then send the browser back to the app. */
export async function oauthCallback(url: URL): Promise<string> {
  const back = (result: string, flowId?: string) =>
    `${config.appReturnUrl}?${new URLSearchParams({ result, ...(flowId ? { flow: flowId } : {}) })}`;
  const flowId = flowIdFromState(url.searchParams.get('state') ?? '');
  const row = flowId
    ? (db().prepare('SELECT hub_id FROM pairing_sessions WHERE flow_id = ? AND expires_at > ?').get(flowId, Date.now()) as
        | { hub_id: string }
        | undefined)
    : undefined;
  if (!flowId || !row) {
    return back('expired');
  }
  try {
    const { baseUrl } = hubCredentials(row.hub_id);
    const forwarded = await fetch(`${baseUrl}/auth/external/callback${url.search}`, { signal: AbortSignal.timeout(20_000) });
    return back(forwarded.ok && !url.searchParams.has('error') ? 'ok' : 'error', flowId);
  } catch {
    return back('error', flowId);
  }
}

// ---- Linked accounts -----------------------------------------------------------------------

interface HaEntry {
  entry_id: string;
  domain: string;
  title: string;
  state: string;
  disabled_by: string | null;
  reason: string | null;
}

interface HaProgress {
  flow_id: string;
  handler: string;
  context: { source?: string; entry_id?: string };
}

export interface LinkedAccount {
  id: string;
  integration: string;
  brand: string;
  title: string;
  state: string;
  /** The brand wants the resident to sign in again. */
  needsReconnect: boolean;
  deviceCount: number;
  problem: string | null;
}

export async function listAccounts(userId: string): Promise<LinkedAccount[]> {
  const runtime = runtimeForUser(userId);
  let entries: HaEntry[];
  let progress: HaProgress[];
  try {
    [entries, progress] = await Promise.all([
      runtime.connection.command<HaEntry[]>({ type: 'config_entries/get' }),
      runtime.connection.command<HaProgress[]>({ type: 'config_entries/flow/progress' }),
    ]);
  } catch {
    throw new ApiError('hub_offline', 'Your home hub is not reachable right now. Try again in a moment.');
  }
  const counts = new Map<string, number>();
  try {
    for (const device of runtime.listDevices()) {
      if (device.accountId) counts.set(device.accountId, (counts.get(device.accountId) ?? 0) + 1);
    }
  } catch {
    // Devices not loaded yet: counts stay zero.
  }
  const reauth = new Set(progress.filter((flow) => flow.context.source === 'reauth').map((flow) => flow.context.entry_id));
  return entries
    .filter((entry) => findIntegration(entry.domain))
    .map((entry) => ({
      id: entry.entry_id,
      integration: entry.domain,
      brand: findIntegration(entry.domain)?.name ?? entry.domain,
      title: entry.title,
      state: entry.state,
      needsReconnect: reauth.has(entry.entry_id) || entry.state === 'setup_error',
      deviceCount: counts.get(entry.entry_id) ?? 0,
      problem: entry.state === 'loaded' ? null : entry.reason,
    }));
}

async function accountFor(userId: string, accountId: string): Promise<{ runtime: HubRuntime; account: LinkedAccount }> {
  const account = (await listAccounts(userId)).find((entry) => entry.id === accountId);
  if (!account) {
    throw new ApiError('not_found', 'No such linked account in your home.');
  }
  return { runtime: runtimeForUser(userId), account };
}

/** Continues the brand's own "sign in again" flow, or reloads the account when there is none. */
export async function reconnectAccount(userId: string, accountId: string): Promise<FlowStep | null> {
  const { runtime } = await accountFor(userId, accountId);
  const progress = await runtime.connection.command<HaProgress[]>({ type: 'config_entries/flow/progress' });
  const flow = progress.find((entry) => entry.context.source === 'reauth' && entry.context.entry_id === accountId);
  if (!flow) {
    await reloadAccount(userId, accountId);
    return null;
  }
  saveSession(flow.flow_id, runtime.hubId, userId, flow.handler);
  return getFlow(userId, flow.flow_id);
}

export async function reloadAccount(userId: string, accountId: string): Promise<void> {
  const { runtime } = await accountFor(userId, accountId);
  const result = await haRest(runtime.hubId, 'POST', `/api/config/config_entries/entry/${encodeURIComponent(accountId)}/reload`);
  if (result.status >= 400) {
    throw new ApiError('ha_rejected', restMessage(result, 'The account could not be reloaded.'));
  }
}

/** Unlinks the account; its devices leave the home with it. */
export async function removeAccount(userId: string, accountId: string): Promise<void> {
  const { runtime } = await accountFor(userId, accountId);
  const result = await haRest(runtime.hubId, 'DELETE', `/api/config/config_entries/entry/${encodeURIComponent(accountId)}`);
  if (result.status >= 400) {
    throw new ApiError('ha_rejected', restMessage(result, 'The account could not be removed.'));
  }
}
