/*
 * The admin dashboard (served at /admin by src/admin/serve.ts): building management signs in with an EMS account
 * that has the `admin` role and manages apartments, residents' accounts and CUBE gateways through /api/admin/*.
 *
 * Plain JavaScript with no dependencies. Text from the server is only ever set with textContent (never innerHTML),
 * and the page's Content-Security-Policy lets it talk to nothing but this backend. The session token lives in
 * sessionStorage, so it ends with the browser tab.
 */
'use strict';

(() => {
  const TOKEN_KEY = 'ems-admin-session';
  const STALE_SYNC_MS = 15 * 60_000;
  const app = document.getElementById('app');
  const who = document.getElementById('who');
  const state = { me: null, tab: 'apartments', units: [], gateways: [], features: null, selectedUnit: null, accountQuery: '' };

  // ---- small helpers ---------------------------------------------------------------------------------

  /** An element: h('button', { class: 'btn', onclick }, 'Save'). Strings become text nodes, never HTML. */
  function h(tag, props, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
      else if (value === true) element.setAttribute(key, '');
      else element.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
  }

  const show = (...nodes) => app.replaceChildren(...nodes);
  const notice = (kind, text) => h('div', { class: `notice ${kind}`, role: kind === 'error' ? 'alert' : 'status', text });

  function readToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function writeToken(value) {
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: the session simply isn't kept across reloads */
    }
  }

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  /** Calls the backend; a 401 sends you to sign-in, a required password change to that form. */
  async function api(method, path, body) {
    const headers = {};
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'network', 'The backend could not be reached. Check your connection and try again.');
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* not JSON */
    }
    if (!response.ok || !payload || payload.ok === false) {
      const error = new ApiError(response.status, payload?.error?.code ?? 'error', payload?.error?.message ?? `Request failed (${response.status}).`);
      const signingIn = path === '/api/auth/login' || path === '/api/auth/change-password';
      if (response.status === 401 && !signingIn) {
        writeToken(null);
        state.me = null;
        renderSignIn('Your session ended. Sign in again.');
      } else if (error.code === 'password_change_required' && path !== '/api/auth/change-password') {
        renderChangePassword();
      }
      throw error;
    }
    return payload.data;
  }

  function timeAgo(value) {
    if (!value) return 'never';
    const at = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isNaN(at)) return '—';
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days < 14 ? `${days} days ago` : new Date(at).toLocaleDateString();
  }

  function randomSecret() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      if (button) {
        const label = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = label), 1500);
      }
    } catch {
      window.prompt('Copy this:', text);
    }
  }

  /** A confirmation; with `typed`, the person must type that text to confirm (for deleting an apartment). */
  function confirmAction(title, message, confirmLabel, { typed, danger = true } = {}) {
    return new Promise((resolve) => {
      const input = typed ? h('input', { 'aria-label': `Type ${typed} to confirm`, autocomplete: 'off' }) : null;
      const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'submit', text: confirmLabel, disabled: Boolean(typed) });
      if (input) input.addEventListener('input', () => (ok.disabled = input.value.trim() !== typed));
      const dialog = h(
        'dialog',
        {},
        h(
          'form',
          { method: 'dialog' },
          h('h2', { text: title }),
          h('p', { class: 'muted', text: message }),
          input ? h('label', { text: `Type "${typed}" to confirm` }) : null,
          input,
          h('div', { class: 'actions' }, h('button', { class: 'btn', value: 'cancel', text: 'Cancel' }), ok),
        ),
      );
      ok.value = 'ok';
      dialog.addEventListener('close', () => {
        resolve(dialog.returnValue === 'ok');
        dialog.remove();
      });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  /** Shows a password or secret once, with a copy button. */
  function showOnce(title, intro, secret, outro) {
    const copyButton = h('button', { class: 'btn', type: 'button', text: 'Copy', onclick: () => copy(secret, copyButton) });
    const dialog = h(
      'dialog',
      {},
      h(
        'form',
        { method: 'dialog' },
        h('h2', { text: title }),
        h('p', { class: 'muted', text: intro }),
        h('div', { class: 'secret', text: secret }),
        outro ? h('p', { class: 'hint', text: outro }) : null,
        h('div', { class: 'actions' }, copyButton, h('button', { class: 'btn primary', text: 'Done' })),
      ),
    );
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  /** Runs `work` with the button disabled, showing any error in `slot`. */
  async function busy(button, slot, work) {
    if (slot) slot.replaceChildren();
    button.disabled = true;
    try {
      return await work();
    } catch (error) {
      if (slot && error instanceof ApiError && error.code !== 'password_change_required' && error.status !== 401) {
        slot.replaceChildren(notice('error', error.message));
      } else if (slot && !(error instanceof ApiError)) {
        slot.replaceChildren(notice('error', 'Something went wrong. Try again.'));
      }
      return undefined;
    } finally {
      button.disabled = false;
    }
  }

  function field(labelText, input, hint) {
    return h('div', {}, h('label', { text: labelText }), input, hint ? h('div', { class: 'hint', text: hint }) : null);
  }

  // ---- pages other files add -----------------------------------------------------------------------------

  /**
   * Each feature's page lives in its own file (admin/pages/*.js, loaded after this one) and registers itself:
   *   ParklaneAdmin.register({ id, label, roles: ['admin'], render(content, ui) })
   * `ui` holds these helpers. A page shows only to the roles it lists, so gate staff (`security`) see their pages
   * and nothing else. The three built-in tabs below are for admins.
   */
  const pages = [];
  const ui = { h, api, notice, busy, field, confirmAction, showOnce, timeAgo, copy, ApiError, me: () => state.me };
  window.ParklaneAdmin = Object.freeze({
    register(page) {
      if (!page || typeof page.id !== 'string' || typeof page.render !== 'function') return;
      pages.push({ roles: ['admin'], ...page });
      if (state.me && !state.me.mustChangePassword) renderDashboard();
    },
  });

  const BUILT_IN_TABS = [
    ['apartments', 'Apartments'],
    ['accounts', 'Accounts'],
    ['gateways', 'Gateways'],
  ];
  const pagesFor = (role) => pages.filter((page) => page.roles.includes(role));
  const mayUseDashboard = (user) => user.role === 'admin' || pagesFor(user.role).length > 0;

  function hubBadge(hub) {
    if (!hub) return h('span', { class: 'badge', text: 'None' });
    const kind = { online: 'ok', provisioning: 'warn' }[hub.status] || 'bad';
    const label = { online: 'Online', provisioning: 'Setting up', offline: 'Offline', auth_failed: 'Login failed', failed: 'Failed' }[hub.status] || hub.status;
    return h('span', { class: `badge ${kind}`, text: label, title: hub.lastError || '' });
  }

  /** A gateway's state: `container` is the one this server runs for the unit, while it is being set up or failed. */
  function gatewayBadge(gateway, container) {
    if (container && container.status === 'provisioning') return h('span', { class: 'badge warn', text: 'Setting up' });
    if (container && container.status === 'failed') return h('span', { class: 'badge bad', text: 'Setup failed', title: container.lastError || '' });
    if (!gateway) return h('span', { class: 'badge', text: 'Not linked' });
    if (!gateway.lastSync) return h('span', { class: 'badge warn', text: 'Never checked in' });
    const stale = Date.now() - Date.parse(gateway.lastSync) > STALE_SYNC_MS;
    return h('span', { class: `badge ${stale ? 'bad' : 'ok'}`, text: stale ? `Last seen ${timeAgo(gateway.lastSync)}` : 'Connected' });
  }

  // ---- signing in --------------------------------------------------------------------------------------

  function renderHeader() {
    if (!state.me) {
      who.hidden = true;
      who.replaceChildren();
      return;
    }
    const signOut = h('button', {
      class: 'btn small',
      text: 'Sign out',
      onclick: async () => {
        try {
          await api('POST', '/api/auth/logout');
        } catch {
          /* signed out here either way */
        }
        writeToken(null);
        state.me = null;
        renderSignIn();
      },
    });
    who.replaceChildren(h('span', { class: 'hide-sm', text: state.me.name || state.me.email }), signOut);
    who.hidden = false;
  }

  function renderSignIn(message) {
    state.me = null;
    renderHeader();
    const email = h('input', { autocomplete: 'username', required: true, autofocus: true });
    const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const slot = h('div');
    const button = h('button', { class: 'btn primary', type: 'submit', text: 'Sign in' });
    const form = h(
      'form',
      {
        onsubmit: (event) => {
          event.preventDefault();
          busy(button, slot, async () => {
            const signedIn = await api('POST', '/api/auth/login', { email: email.value, password: password.value });
            writeToken(signedIn.token);
            afterSignIn(signedIn.user);
          });
        },
      },
      field('Email or username', email),
      field('Password', password),
      slot,
      h('div', { class: 'actions' }, button),
    );
    show(
      h(
        'div',
        { class: 'card narrow' },
        h('h1', { text: 'Building management' }),
        h('p', { class: 'muted', text: 'Sign in with your EMS admin account.' }),
        message ? notice('ok', message) : null,
        form,
      ),
    );
  }

  function afterSignIn(user) {
    state.me = user;
    renderHeader();
    if (user.mustChangePassword) renderChangePassword();
    else if (!mayUseDashboard(user)) renderNotAdmin();
    else renderDashboard();
  }

  function renderChangePassword() {
    renderHeader();
    const current = h('input', { type: 'password', autocomplete: 'current-password', required: true, autofocus: true });
    const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
    const again = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const slot = h('div');
    const button = h('button', { class: 'btn primary', type: 'submit', text: 'Save my password' });
    const form = h(
      'form',
      {
        onsubmit: (event) => {
          event.preventDefault();
          if (next.value.length < 10) {
            slot.replaceChildren(notice('error', 'Choose a password of at least 10 characters.'));
            return;
          }
          if (next.value !== again.value) {
            slot.replaceChildren(notice('error', 'The two new passwords are different.'));
            return;
          }
          busy(button, slot, async () => {
            const { user } = await api('POST', '/api/auth/change-password', { currentPassword: current.value, newPassword: next.value });
            afterSignIn(user);
          });
        },
      },
      field('Temporary (current) password', current),
      field('New password', next, 'At least 10 characters, not your email.'),
      field('New password again', again),
      slot,
      h('div', { class: 'actions' }, button),
    );
    show(
      h(
        'div',
        { class: 'card narrow' },
        h('h1', { text: 'Choose your own password' }),
        h('p', { class: 'muted', text: 'Your account was created with a temporary password. Choose your own to continue.' }),
        form,
      ),
    );
  }

  function renderNotAdmin() {
    renderHeader();
    show(
      h(
        'div',
        { class: 'card narrow' },
        h('h1', { text: 'Not an admin account' }),
        h('p', { class: 'muted', text: 'This account can use the Parklane app but not building management. Sign out and use an admin account.' }),
      ),
    );
  }

  // ---- the dashboard -----------------------------------------------------------------------------------

  async function renderDashboard() {
    renderHeader();
    const content = h('div');
    const isAdmin = state.me?.role === 'admin';
    const extra = pagesFor(state.me?.role).map((page) => [page.id, page.label]);
    const tabs = [...(isAdmin ? BUILT_IN_TABS : []), ...extra];
    if (!tabs.some(([id]) => id === state.tab)) state.tab = tabs[0]?.[0] ?? 'apartments';
    const tabBar = h(
      'div',
      { class: 'tabs', role: 'tablist' },
      tabs.map(([id, label]) =>
        h('button', {
          class: 'tab',
          role: 'tab',
          'aria-selected': String(state.tab === id),
          text: label,
          onclick: () => {
            state.tab = id;
            renderDashboard();
          },
        }),
      ),
    );
    show(tabBar, content);
    content.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
    const page = pages.find((entry) => entry.id === state.tab);
    if (page) {
      try {
        await page.render(content, ui);
      } catch (error) {
        if (!(error instanceof ApiError) || (error.status !== 401 && error.code !== 'password_change_required')) {
          content.replaceChildren(notice('error', error instanceof ApiError ? error.message : 'This page could not be shown.'));
        }
      }
      return;
    }
    try {
      await loadAll();
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401 && error.code !== 'password_change_required') {
        content.replaceChildren(notice('error', error.message));
      }
      return;
    }
    if (state.tab === 'apartments') renderApartments(content);
    else if (state.tab === 'accounts') renderAccounts(content);
    else renderGateways(content);
  }

  async function loadAll() {
    const [units, gateways, features] = await Promise.all([
      api('GET', '/api/admin/units'),
      api('GET', '/api/admin/gateways'),
      state.features || api('GET', '/api/admin/features'),
    ]);
    state.units = units;
    state.gateways = gateways;
    state.features = features;
  }

  const containerOf = (unitId) => state.units.find((unit) => unit.id === unitId)?.gatewayContainer || null;

  const gatewayOf = (unitId) => state.gateways.find((gateway) => gateway.unitId === unitId) || null;
  const unitName = (unitId) => state.units.find((unit) => unit.id === unitId)?.name || '—';

  // ---- apartments ----

  function renderApartments(content) {
    const filter = h('input', { type: 'search', placeholder: 'Find an apartment', 'aria-label': 'Find an apartment' });
    const tableSlot = h('div', { class: 'table-wrap' });
    const detail = h('div');
    const draw = () => {
      const query = filter.value.trim().toLowerCase();
      const rows = state.units.filter((unit) => !query || `${unit.name} ${unit.building || ''}`.toLowerCase().includes(query));
      if (!state.units.length) {
        tableSlot.replaceChildren(h('div', { class: 'empty', text: 'No apartments yet. Create the first one.' }));
        return;
      }
      tableSlot.replaceChildren(
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Apartment' }), h('th', { text: 'Building' }), h('th', { text: 'Home Assistant' }), h('th', { text: 'CUBE gateway' }))),
          h(
            'tbody',
            {},
            rows.map((unit) =>
              h(
                'tr',
                {
                  class: `clickable${state.selectedUnit === unit.id ? ' selected' : ''}`,
                  tabindex: 0,
                  onclick: () => openUnit(unit.id, detail, draw),
                  onkeydown: (event) => event.key === 'Enter' && openUnit(unit.id, detail, draw),
                },
                h('td', { text: unit.name }),
                h('td', { text: unit.building || '—' }),
                h('td', {}, hubBadge(unit.hub)),
                h('td', {}, gatewayBadge(gatewayOf(unit.id), unit.gatewayContainer)),
              ),
            ),
          ),
        ),
      );
    };
    filter.addEventListener('input', draw);
    const newButton = h('button', { class: 'btn primary', text: 'New apartment', onclick: () => detail.replaceChildren(newUnitForm(detail, draw)) });
    content.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'toolbar' }, filter, newButton), tableSlot), detail);
    draw();
    if (state.selectedUnit && state.units.some((unit) => unit.id === state.selectedUnit)) openUnit(state.selectedUnit, detail, draw);
  }

  function newUnitForm(detail, redraw) {
    const name = h('input', { required: true, placeholder: 'e.g. Tower A · 1203', autofocus: true });
    const building = h('input', { placeholder: 'Optional' });
    const provision = h('input', { type: 'checkbox', checked: true });
    const makeGateway = state.features?.gatewayContainers ? h('input', { type: 'checkbox', checked: true }) : null;
    const slot = h('div');
    const button = h('button', { class: 'btn primary', type: 'submit', text: 'Create apartment' });
    return h(
      'div',
      { class: 'card' },
      h('h2', { text: 'New apartment' }),
      h(
        'form',
        {
          onsubmit: (event) => {
            event.preventDefault();
            busy(button, slot, async () => {
              const created = await api('POST', '/api/admin/units', {
                name: name.value,
                building: building.value,
                provision: provision.checked,
                gateway: makeGateway ? makeGateway.checked : false,
              });
              await loadAll();
              state.selectedUnit = created.id;
              redraw();
              openUnit(created.id, detail, redraw);
            });
          },
        },
        h('div', { class: 'row' }, field('Name', name), field('Building', building)),
        h('label', { class: 'check' }, provision, 'Create its Home Assistant now (for brand-account devices)'),
        makeGateway ? h('label', { class: 'check' }, makeGateway, 'Create its CUBE gateway now (residents connect by signing in)') : null,
        slot,
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => detail.replaceChildren() }), button),
      ),
    );
  }

  async function openUnit(unitId, detail, redraw) {
    state.selectedUnit = unitId;
    redraw();
    detail.replaceChildren(h('div', { class: 'card empty', text: 'Loading…' }));
    let unit;
    try {
      unit = await api('GET', `/api/admin/units/${encodeURIComponent(unitId)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) detail.replaceChildren(notice('error', error.message));
      return;
    }
    const refresh = async () => {
      await loadAll();
      redraw();
      await openUnit(unitId, detail, redraw);
    };
    const remove = h('button', {
      class: 'btn danger small',
      text: 'Delete apartment',
      onclick: async () => {
        const sure = await confirmAction(
          'Delete this apartment?',
          'Its residents leave it, its Home Assistant and CUBE gateway containers are removed (their data is kept on the server) and its gateway is unlinked.',
          'Delete',
          { typed: unit.name },
        );
        if (!sure) return;
        await busy(remove, null, async () => {
          await api('DELETE', `/api/admin/units/${encodeURIComponent(unitId)}`);
          state.selectedUnit = null;
          await loadAll();
          redraw();
          detail.replaceChildren(notice('ok', `${unit.name} was deleted.`));
        });
      },
    });
    detail.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'toolbar' }, h('div', {}, h('h2', { text: unit.name }), h('div', { class: 'muted', text: unit.building || 'No building set' })), remove),
        h('div', { class: 'grid2' }, membersPanel(unit, refresh), h('div', {}, gatewayPanel(unit, refresh), hubPanel(unit, refresh))),
      ),
    );
  }

  function membersPanel(unit, refresh) {
    const list = unit.members.length
      ? unit.members.map((member) => {
          const removeButton = h('button', {
            class: 'btn danger small',
            text: 'Remove',
            onclick: async () => {
              const sure = await confirmAction(
                `Remove ${member.name}?`,
                `${member.name} leaves ${unit.name}: their brand-account devices stop at once, and the CUBE gateway drops their phones within five minutes. Their EMS account stays.`,
                'Remove',
              );
              if (sure) await busy(removeButton, null, async () => {
                await api('DELETE', `/api/admin/units/${encodeURIComponent(unit.id)}/members/${encodeURIComponent(member.userId)}`);
                await refresh();
              });
            },
          });
          return h(
            'div',
            { class: 'member' },
            h('div', {}, h('div', { text: member.name }), h('div', { class: 'muted mono', text: member.email })),
            h('div', { class: 'member-actions' }, h('span', { class: `badge ${member.role === 'owner' ? 'accent' : ''}`, text: member.role === 'owner' ? 'Owner' : 'Member' }), removeButton),
          );
        })
      : [h('div', { class: 'empty', text: 'Nobody lives here yet.' })];

    const email = h('input', { type: 'email', placeholder: 'their EMS email', required: true });
    const role = h('select', {}, h('option', { value: 'owner', text: 'Owner' }), h('option', { value: 'member', text: 'Member' }));
    const slot = h('div');
    const add = h('button', { class: 'btn', type: 'submit', text: 'Add' });
    const addForm = h(
      'form',
      {
        onsubmit: (event) => {
          event.preventDefault();
          busy(add, slot, async () => {
            await api('POST', `/api/admin/units/${encodeURIComponent(unit.id)}/members`, { email: email.value, role: role.value });
            await refresh();
          });
        },
      },
      h('div', { class: 'row' }, field('Add an existing account', email), field('As', role), add),
      slot,
    );
    const create = h('button', {
      class: 'btn small',
      text: 'Create an account for this apartment',
      onclick: () => {
        state.tab = 'accounts';
        state.prefillUnit = unit.id;
        renderDashboard();
      },
    });
    return h('div', {}, h('h3', { text: 'Residents' }), ...list, addForm, h('div', { class: 'hint' }, 'No account yet? ', create));
  }

  function gatewayPanel(unit, refresh) {
    const container = unit.gatewayContainer && unit.gatewayContainer.status !== 'removed' ? unit.gatewayContainer : null;
    if (container) return serverGatewayPanel(unit, container, refresh);
    if (unit.gateway) {
      const unlink = h('button', {
        class: 'btn danger small',
        text: 'Unlink',
        onclick: async () => {
          const sure = await confirmAction('Unlink the gateway?', 'Residents stop getting passes for it; phones already connected keep working until removed on the gateway.', 'Unlink');
          if (sure) await busy(unlink, null, async () => {
            await api('DELETE', `/api/admin/gateways/${encodeURIComponent(unit.gateway.id)}`);
            await refresh();
          });
        },
      });
      return h(
        'div',
        {},
        h('h3', { text: 'CUBE gateway' }),
        h('div', { class: 'member' }, h('div', {}, h('div', { class: 'mono', text: unit.gateway.id }), h('div', { class: 'muted mono', text: unit.gateway.url || 'No relay address' })), gatewayBadge(unit.gateway)),
        h('div', { class: 'hint', text: `Last member check: ${timeAgo(unit.gateway.lastSync)}. Gateways check every five minutes.` }),
        h('div', { class: 'actions' }, unlink),
      );
    }
    const id = h('input', { required: true, placeholder: 'from the gateway: /api/v1/health → gateway_id', class: 'mono' });
    const url = h('input', { placeholder: 'https://cube-relay.ems-iot.com/relay/v1/g/<id>', class: 'mono' });
    const secret = h('input', { required: true, class: 'mono', minlength: 32 });
    id.addEventListener('input', () => {
      if (!url.dataset.edited) url.value = id.value.trim() ? `https://cube-relay.ems-iot.com/relay/v1/g/${id.value.trim().toLowerCase()}` : '';
    });
    url.addEventListener('input', () => (url.dataset.edited = '1'));
    const generate = h('button', { class: 'btn small', type: 'button', text: 'Generate', onclick: () => (secret.value = randomSecret()) });
    const slot = h('div');
    const link = h('button', { class: 'btn primary', type: 'submit', text: 'Link gateway' });
    const linkForm = h(
      'form',
      {
        onsubmit: (event) => {
          event.preventDefault();
          busy(link, slot, async () => {
            await api('POST', '/api/admin/gateways', { unitId: unit.id, gatewayId: id.value, secret: secret.value, url: url.value });
            await refresh();
          });
        },
      },
      field('Gateway id', id),
      field('Relay address', url),
      h('div', { class: 'row' }, field('Sync secret', secret, 'Start the gateway with the same value: CUBE_EMS_SECRET=…'), generate),
      slot,
      h('div', { class: 'actions' }, link),
    );
    const unitIdHint = h('p', { class: 'hint' }, 'Unit id for scripts: ', h('span', { class: 'mono', text: unit.id }));
    if (!state.features?.gatewayContainers) {
      return h(
        'div',
        {},
        h('h3', { text: 'CUBE gateway' }),
        h('p', { class: 'muted', text: 'Not linked. On the server, new-apartment.sh with UNIT_ID links it for you; for a box at home, link it here.' }),
        linkForm,
        unitIdHint,
      );
    }
    const createSlot = h('div');
    const create = h('button', {
      class: 'btn primary',
      text: unit.gatewayContainer ? 'Start the gateway again' : 'Create gateway',
      onclick: () =>
        busy(create, createSlot, async () => {
          await api('POST', `/api/admin/units/${encodeURIComponent(unit.id)}/gateway`, {});
          await refresh();
        }),
    });
    return h(
      'div',
      {},
      h('h3', { text: 'CUBE gateway' }),
      h('p', {
        class: 'muted',
        text: unit.gatewayContainer
          ? 'Removed. Starting it again brings back the same gateway, with its devices.'
          : 'Not created. The server can run this apartment\'s gateway; residents then connect by signing in.',
      }),
      createSlot,
      h('div', { class: 'actions' }, create),
      h('details', {}, h('summary', { class: 'muted', text: 'Or link a gateway box at home' }), linkForm),
      unitIdHint,
    );
  }

  /** The gateway this server runs for the apartment: its state, and updating or removing it. */
  function serverGatewayPanel(unit, container, refresh) {
    const path = `/api/admin/units/${encodeURIComponent(unit.id)}/gateway`;
    const slot = h('div');
    const retry = h('button', {
      class: 'btn small',
      text: 'Try again',
      onclick: () =>
        busy(retry, slot, async () => {
          await api('POST', path, {});
          await refresh();
        }),
    });
    const update = h('button', {
      class: 'btn small',
      text: 'Update',
      onclick: async () => {
        const sure = await confirmAction(
          'Update this gateway?',
          'It restarts on the newest gateway version and keeps its devices and phones. Control pauses for about a minute.',
          'Update',
          { danger: false },
        );
        if (sure) await busy(update, slot, async () => {
          await api('POST', path, { update: true });
          await refresh();
        });
      },
    });
    const remove = h('button', {
      class: 'btn danger small',
      text: 'Remove',
      onclick: async () => {
        const sure = await confirmAction(
          'Remove this gateway?',
          'It stops and is unlinked, so residents lose access to it. Its devices and settings stay saved on the server: starting it again brings it back.',
          'Remove',
        );
        if (sure) await busy(remove, slot, async () => {
          await api('DELETE', path);
          await refresh();
        });
      },
    });
    const panel = h(
      'div',
      {},
      h('h3', { text: 'CUBE gateway (on the server)' }),
      h(
        'div',
        { class: 'member' },
        h('div', {}, h('div', { class: 'mono', text: container.gatewayId }), h('div', { class: 'muted mono', text: unit.gateway?.url || 'Linking…' })),
        gatewayBadge(unit.gateway, container),
      ),
      container.status === 'provisioning' ? h('div', { class: 'hint', text: 'Starting it and waiting for it to connect. This takes up to three minutes the first time.' }) : null,
      container.lastError ? h('div', { class: 'notice error', text: container.lastError }) : null,
      container.status === 'running' && unit.gateway ? h('div', { class: 'hint', text: `Last member check: ${timeAgo(unit.gateway.lastSync)}. Gateways check every five minutes.` }) : null,
      h('div', { class: 'hint' }, 'Container: ', h('span', { class: 'mono', text: container.containerName }), container.port ? ` · port ${container.port}` : ''),
      slot,
      h('div', { class: 'actions' }, container.status === 'failed' ? retry : null, container.status === 'running' ? update : null, container.status === 'provisioning' ? null : remove),
    );
    // While it starts, look again every few seconds (only while this panel is still shown).
    if (container.status === 'provisioning') {
      setTimeout(() => {
        if (panel.isConnected) refresh();
      }, 5000);
    }
    return panel;
  }

  function hubPanel(unit, refresh) {
    const provision = h('button', {
      class: 'btn small',
      text: unit.hub ? 'Retry setup' : 'Create Home Assistant',
      onclick: () =>
        busy(provision, null, async () => {
          await api('POST', `/api/admin/units/${encodeURIComponent(unit.id)}/provision`);
          await refresh();
        }),
    });
    const healthy = unit.hub && unit.hub.status === 'online';
    return h(
      'div',
      {},
      h('h3', { text: 'Home Assistant (brand accounts)' }),
      h('div', { class: 'member' }, h('div', { class: 'muted', text: unit.hub ? `${unit.hub.kind} · version ${unit.hub.haVersion || '—'}` : 'Not created' }), hubBadge(unit.hub)),
      unit.hub && unit.hub.lastError ? h('div', { class: 'hint', text: unit.hub.lastError }) : null,
      healthy ? null : h('div', { class: 'actions' }, provision),
    );
  }

  // ---- accounts ----

  function renderAccounts(content) {
    const search = h('input', { type: 'search', placeholder: 'Find by name or email', 'aria-label': 'Find by name or email', value: state.accountQuery });
    const tableSlot = h('div', { class: 'table-wrap' }, h('div', { class: 'empty', text: 'Loading…' }));
    const formSlot = h('div');
    let timer = null;
    const load = async () => {
      let users;
      try {
        users = await api('GET', `/api/admin/users?q=${encodeURIComponent(state.accountQuery)}`);
      } catch (error) {
        if (error instanceof ApiError && error.status !== 401) tableSlot.replaceChildren(notice('error', error.message));
        return;
      }
      if (!users.length) {
        tableSlot.replaceChildren(h('div', { class: 'empty', text: state.accountQuery ? 'No account matches.' : 'No accounts yet.' }));
        return;
      }
      tableSlot.replaceChildren(
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Name' }), h('th', { text: 'Email' }), h('th', { text: 'Role' }), h('th', { text: 'Apartment' }), h('th', { text: '' }))),
          h('tbody', {}, users.map((user) => accountRow(user))),
        ),
      );
    };
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.accountQuery = search.value.trim();
        load();
      }, 250);
    });
    const newButton = h('button', { class: 'btn primary', text: 'New account', onclick: () => formSlot.replaceChildren(newAccountForm(formSlot, load)) });
    content.replaceChildren(formSlot, h('div', { class: 'card' }, h('div', { class: 'toolbar' }, search, newButton), tableSlot));
    if (state.prefillUnit) formSlot.replaceChildren(newAccountForm(formSlot, load));
    load();
  }

  function accountRow(user) {
    const reset = h('button', {
      class: 'btn small',
      text: 'Reset password',
      onclick: async () => {
        const sure = await confirmAction(
          `Reset ${user.name}'s password?`,
          'They are signed out everywhere and get a temporary password, which they must replace at their next sign-in.',
          'Reset',
          { danger: false },
        );
        if (!sure) return;
        const result = await busy(reset, null, () => api('POST', `/api/admin/users/${encodeURIComponent(user.id)}/reset-password`));
        if (result) showOnce('Temporary password', `Give this to ${user.name} (${user.email}). It is shown only now.`, result.temporaryPassword, 'They will choose their own at the next sign-in.');
      },
    });
    const roleLabel = { admin: 'Admin', resident: 'Resident', doctor: 'Doctor', clinic_staff: 'Clinic desk', security: 'Gate staff' }[user.role] || user.role;
    return h(
      'tr',
      {},
      h('td', {}, user.name, user.mustChangePassword ? h('div', {}, h('span', { class: 'badge warn', text: 'Temporary password' })) : null),
      h('td', { class: 'mono', text: user.email }),
      h('td', {}, h('span', { class: `badge ${user.role === 'admin' ? 'accent' : ''}`, text: roleLabel })),
      h('td', { text: user.unit ? `${user.unit.name} (${user.unit.role === 'member' ? 'member' : 'owner'})` : '—' }),
      h('td', { class: 'right' }, reset),
    );
  }

  function newAccountForm(slotElement, reload) {
    const email = h('input', { type: 'email', required: true, autofocus: true, placeholder: 'name@example.com' });
    const name = h('input', { placeholder: 'Full name' });
    const role = h(
      'select',
      {},
      h('option', { value: 'resident', text: 'Resident' }),
      h('option', { value: 'security', text: 'Gate staff (security)' }),
      h('option', { value: 'admin', text: 'Admin (building management)' }),
    );
    const unit = h(
      'select',
      {},
      h('option', { value: '', text: 'No apartment' }),
      state.units.map((u) => h('option', { value: u.id, text: u.building ? `${u.name} · ${u.building}` : u.name, selected: state.prefillUnit === u.id })),
    );
    const unitRole = h('select', {}, h('option', { value: 'owner', text: 'Owner' }), h('option', { value: 'member', text: 'Member' }));
    const syncRole = () => {
      const isAdmin = role.value === 'admin';
      unit.disabled = isAdmin;
      unitRole.disabled = isAdmin || !unit.value;
    };
    role.addEventListener('change', syncRole);
    unit.addEventListener('change', syncRole);
    syncRole();
    state.prefillUnit = null;
    const slot = h('div');
    const button = h('button', { class: 'btn primary', type: 'submit', text: 'Create account' });
    return h(
      'div',
      { class: 'card' },
      h('h2', { text: 'New account' }),
      h('p', { class: 'muted', text: 'The account gets a temporary password, shown once. At the first sign-in its owner must choose their own.' }),
      h(
        'form',
        {
          onsubmit: (event) => {
            event.preventDefault();
            busy(button, slot, async () => {
              const created = await api('POST', '/api/admin/users', {
                email: email.value,
                name: name.value,
                role: role.value,
                unitId: role.value === 'admin' ? '' : unit.value,
                unitRole: unitRole.value,
              });
              slotElement.replaceChildren(notice('ok', `Account created for ${created.user.email}.`));
              showOnce(
                'Temporary password',
                `Give this to ${created.user.name} with their email (${created.user.email}). It is shown only now.`,
                created.temporaryPassword,
                'They sign in to the Parklane app (or this dashboard, for an admin) and choose their own password.',
              );
              await loadAll();
              reload();
            });
          },
        },
        h('div', { class: 'row' }, field('Email', email), field('Name', name)),
        h('div', { class: 'row' }, field('Account type', role), field('Apartment', unit), field('As', unitRole)),
        slot,
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => slotElement.replaceChildren() }), button),
      ),
    );
  }

  // ---- gateways ----

  function renderGateways(content) {
    if (!state.gateways.length) {
      content.replaceChildren(h('div', { class: 'card empty', text: 'No CUBE gateways are linked to apartments yet.' }));
      return;
    }
    content.replaceChildren(
      h(
        'div',
        { class: 'card table-wrap' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Apartment' }), h('th', { text: 'Gateway id' }), h('th', { class: 'hide-sm', text: 'Relay address' }), h('th', { text: 'Status' }))),
          h(
            'tbody',
            {},
            state.gateways.map((gateway) =>
              h(
                'tr',
                {
                  class: 'clickable',
                  onclick: () => {
                    state.tab = 'apartments';
                    state.selectedUnit = gateway.unitId;
                    renderDashboard();
                  },
                },
                h('td', { text: unitName(gateway.unitId) }),
                h('td', { class: 'mono', text: gateway.id }),
                h('td', { class: 'mono hide-sm', text: gateway.url || '—' }),
                h('td', {}, gatewayBadge(gateway, containerOf(gateway.unitId))),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---- start ----

  async function start() {
    if (!readToken()) {
      renderSignIn();
      return;
    }
    try {
      const { user } = await api('GET', '/api/auth/me');
      afterSignIn(user);
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 401 && error.code !== 'password_change_required')) renderSignIn();
    }
  }

  start();
})();
