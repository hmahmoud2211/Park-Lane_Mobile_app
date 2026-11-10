/*
 * The gate (gate staff and admins): check a visitor's pass by scanning its QR code (a handheld scanner types it into
 * the box) or typing it, let the visitor in or out, see today's visitors, and log parcels and hand them over.
 * Talks to /api/security/*. Text is only ever set with textContent.
 */
'use strict';

(() => {
  const DECISION = {
    admit: ['ok', 'Valid: let them in'],
    exit: ['ok', 'Inside: record them leaving'],
    too_early: ['warn', 'Too early for this pass'],
    expired: ['bad', 'This pass has expired'],
    revoked: ['bad', 'The resident cancelled this pass'],
    used: ['bad', 'This pass was already used'],
    unknown: ['bad', 'Not a Parklane visitor pass'],
  };
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  window.ParklaneAdmin.register({
    id: 'gate',
    label: 'Gate',
    roles: ['security', 'admin'],
    async render(content, ui) {
      const { h, api, notice, busy, field } = ui;
      const code = h('input', { placeholder: 'Scan or paste the pass code', autocomplete: 'off', 'aria-label': 'Pass code' });
      const gateName = h('input', { value: 'Main gate', 'aria-label': 'Gate' });
      const result = h('div');
      const todaySlot = h('div');
      const parcelSlot = h('div');

      async function check() {
        result.replaceChildren();
        const value = code.value.trim();
        if (!value) return;
        const answer = await api('POST', '/api/security/visitors/check', { code: value });
        const [tone, text] = DECISION[answer.decision] || ['bad', answer.decision];
        const pass = answer.pass;
        const act = (kind, label) => {
          const button = h('button', { class: 'btn primary', text: label });
          button.addEventListener('click', () => busy(button, result, async () => {
            await api('POST', `/api/security/visitors/${encodeURIComponent(pass.id)}/${kind}`, { gate: gateName.value });
            result.replaceChildren(notice('ok', kind === 'entry' ? `${pass.visitorName} let in.` : `${pass.visitorName} left.`));
            code.value = '';
            code.focus();
            drawToday();
          }));
          return button;
        };
        result.replaceChildren(
          notice(tone === 'ok' ? 'ok' : 'error', text),
          pass ? h('p', { text: `${pass.visitorName} · ${pass.guests} guest${pass.guests === 1 ? '' : 's'}${pass.plate ? ` · ${pass.plate}` : ''} · for ${pass.unitName} · expected ${time(pass.arrivesAt)}` }) : null,
          answer.decision === 'admit' ? act('entry', 'Let in') : answer.decision === 'exit' ? act('exit', 'Record leaving') : null,
        );
      }
      code.addEventListener('keydown', (event) => { if (event.key === 'Enter') check(); });
      const checkButton = h('button', { class: 'btn primary', text: 'Check' });
      checkButton.addEventListener('click', () => busy(checkButton, result, check));

      async function drawToday() {
        const list = await api('GET', '/api/security/visitors/today');
        todaySlot.replaceChildren(list.length
          ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Expected', 'Visitor', 'Guests', 'Plate', 'Apartment', 'Status'].map((t) => h('th', { text: t })))),
              h('tbody', {}, list.map((v) => h('tr', {}, h('td', { text: time(v.arrivesAt) }), h('td', { text: v.visitorName }), h('td', { text: String(v.guests) }), h('td', { text: v.plate || '—' }), h('td', { text: v.unitName }), h('td', { text: v.status }))))))
          : h('p', { class: 'muted', text: 'No visitors expected today.' }));
      }

      async function drawParcels() {
        const [units, waiting] = await Promise.all([api('GET', '/api/security/units'), api('GET', '/api/security/parcels')]);
        const unit = h('select', { 'aria-label': 'Apartment' }, h('option', { value: '', text: 'Apartment' }), units.map((u) => h('option', { value: u.id, text: u.name })));
        const carrier = h('input', { placeholder: 'Courier, e.g. Aramex' });
        const description = h('input', { placeholder: 'e.g. 1 box' });
        const status = h('div');
        const log = h('button', { class: 'btn primary', text: 'Log parcel' });
        log.addEventListener('click', () => busy(log, status, async () => {
          const parcel = await api('POST', '/api/security/parcels', { unitId: unit.value, carrier: carrier.value, description: description.value });
          status.replaceChildren(notice('ok', `Logged ${parcel.reference} for ${parcel.unitName}. The residents were told.`));
          setTimeout(drawParcels, 900);
        }));
        const rows = waiting.map((p) => {
          const hand = (kind, label) => {
            const button = h('button', { class: 'btn small', text: label });
            button.addEventListener('click', () => busy(button, status, async () => { await api('POST', `/api/security/parcels/${encodeURIComponent(p.id)}/${kind}`); drawParcels(); }));
            return button;
          };
          return h('tr', {}, h('td', { text: p.reference }), h('td', { text: p.unitName }), h('td', { text: [p.carrier, p.description].filter(Boolean).join(' · ') || '—' }),
            h('td', { text: time(p.receivedAt) }), h('td', {}, hand('collect', 'Collected'), ' ', hand('return', 'Returned')));
        });
        parcelSlot.replaceChildren(
          h('div', { class: 'row' }, field('For', unit), field('Courier', carrier), field('What', description), log), status,
          rows.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Reference', 'Apartment', 'Parcel', 'Arrived', ''].map((t) => h('th', { text: t })))), h('tbody', {}, rows)))
            : h('p', { class: 'muted', text: 'No parcels waiting.' }),
        );
      }

      content.replaceChildren(
        h('section', { class: 'card' }, h('h2', { text: 'Check a visitor' }), h('div', { class: 'row' }, field('Pass code', code), field('Gate', gateName), checkButton), result),
        h('section', { class: 'card' }, h('h2', { text: 'Today\'s visitors' }), todaySlot),
        h('section', { class: 'card' }, h('h2', { text: 'Parcels' }), parcelSlot),
      );
      code.focus();
      await Promise.all([drawToday(), drawParcels()]);
    },
  });
})();
