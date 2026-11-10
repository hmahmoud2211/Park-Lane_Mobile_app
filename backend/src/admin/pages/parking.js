/*
 * Parking (gate staff and admins): scan a parking pass at a gate (a handheld scanner types it into the box), let a
 * car in or out by hand with a reason, see who is expected and who is inside, handle visitors' help requests, and
 * mark bays and chargers. Talks to /api/security/parking/*. Text is only ever set with textContent.
 */
'use strict';

(() => {
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayTime = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  window.ParklaneAdmin.register({
    id: 'parking',
    label: 'Parking',
    roles: ['security', 'admin'],
    async render(content, ui) {
      const { h, api, notice, busy, field } = ui;
      const scanSlot = h('div');
      const alertsSlot = h('div');
      const insideSlot = h('div');
      const expectedSlot = h('div');
      const baysSlot = h('div');
      let desk = { gates: [] };
      const table = (heads, rows) => h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((t) => h('th', { text: t })))), h('tbody', {}, rows)));
      const act = (label, status, work, cls = 'small') => {
        const button = h('button', { class: `btn ${cls}`, text: label });
        button.addEventListener('click', () => busy(button, status, async () => { await work(); await draw(); }));
        return button;
      };
      const gatePicker = (filter) => h('select', { 'aria-label': 'Gate' }, desk.gates.filter(filter).map((g) => h('option', { value: g.id, text: g.name })));

      function drawScan() {
        const code = h('input', { placeholder: 'Scan or paste the parking pass', autocomplete: 'off', 'aria-label': 'Parking pass' });
        const gate = gatePicker(() => true);
        const direction = h('select', { 'aria-label': 'Direction' }, h('option', { value: 'entry', text: 'Entering' }), h('option', { value: 'exit', text: 'Leaving' }));
        const result = h('div');
        const scan = h('button', { class: 'btn primary', text: 'Check pass' });
        const run = () => busy(scan, result, async () => {
          const answer = await api('POST', '/api/security/parking/scan', { code: code.value.trim(), gateId: gate.value, direction: direction.value });
          result.replaceChildren(notice(answer.outcome === 'rejected' ? 'error' : 'ok', `${answer.title}. ${answer.message}${answer.gateOpened ? ' The barrier may open.' : ''}`));
          code.value = '';
          code.focus();
          await draw(false);
        });
        scan.addEventListener('click', run);
        code.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(); });
        scanSlot.replaceChildren(h('div', { class: 'row' }, field('Pass', code), field('Gate', gate), field('Direction', direction), scan), result);
        code.focus();
      }

      async function draw(withScan = true) {
        desk = await api('GET', '/api/security/parking');
        if (withScan) drawScan();
        const status = h('div');

        alertsSlot.replaceChildren(status, desk.alerts.length
          ? table(['When', 'Alert', ''], desk.alerts.map((a) => h('tr', {}, h('td', { text: dayTime(a.at) }), h('td', {}, h('strong', { text: a.title }), h('br'), a.body),
            h('td', {}, act('Handled', status, () => api('POST', `/api/security/parking/alerts/${encodeURIComponent(a.id)}/resolve`, { note: 'Handled at the desk' }))))))
          : h('p', { class: 'muted', text: 'No open alerts.' }));

        insideSlot.replaceChildren(desk.inside.length
          ? table(['Visitor', 'Apartment', 'Plate', 'Bay', 'Until', ''], desk.inside.map((v) => {
            const reason = h('input', { placeholder: 'Reason (no scan)', 'aria-label': `Reason for letting ${v.name} out` });
            const gate = gatePicker((g) => g.direction !== 'entry');
            return h('tr', {}, h('td', { text: v.name }), h('td', { text: v.unit }), h('td', { text: v.plate || '—' }), h('td', { text: v.bay }),
              h('td', {}, v.overdue ? h('span', { class: 'badge bad', text: `Overdue · ${time(v.until)}` }) : time(v.until)),
              h('td', {}, reason, ' ', gate, ' ', act('Let out', status, () => api('POST', `/api/security/parking/reservations/${encodeURIComponent(v.id)}/exit`, { gateId: gate.value, reason: reason.value }))));
          }))
          : h('p', { class: 'muted', text: 'No visitors inside.' }));

        expectedSlot.replaceChildren(desk.upcoming.length
          ? table(['From', 'Visitor', 'Apartment', 'Plate', 'Bay', ''], desk.upcoming.map((v) => {
            const reason = h('input', { placeholder: 'Reason (no scan)', 'aria-label': `Reason for letting ${v.name} in` });
            const plate = h('input', { placeholder: 'Plate', value: v.plate || '', 'aria-label': `Plate of ${v.name}` });
            const gate = gatePicker((g) => g.direction !== 'exit');
            return h('tr', {}, h('td', { text: dayTime(v.from) }), h('td', {}, v.name, v.needsReassignment ? h('span', { class: 'badge warn', text: ' Needs a new bay' }) : null), h('td', { text: v.unit }),
              h('td', { text: v.plate || '—' }), h('td', { text: v.bay }),
              h('td', {}, reason, ' ', plate, ' ', gate, ' ', act('Let in', status, () => api('POST', `/api/security/parking/reservations/${encodeURIComponent(v.id)}/entry`, { gateId: gate.value, reason: reason.value, plate: plate.value })),
                v.needsReassignment ? act('Move bay', status, () => api('POST', `/api/security/parking/reservations/${encodeURIComponent(v.id)}/reassign`, {})) : null));
          }))
          : h('p', { class: 'muted', text: 'No upcoming visits.' }));

        const bayRows = desk.bays.map((b) => {
          const note = h('input', { placeholder: 'Note', 'aria-label': `Note for ${b.label}` });
          const occupancy = h('select', { 'aria-label': `Occupancy of ${b.label}` }, ['vacant', 'occupied', 'unknown'].map((s) => h('option', { value: s, text: s, selected: s === b.occupancy })));
          const service = h('select', { 'aria-label': `Service of ${b.label}` }, ['in-service', 'maintenance', 'out-of-service'].map((s) => h('option', { value: s, text: s.replace(/-/g, ' '), selected: s === b.serviceability })));
          return h('tr', {}, h('td', { text: b.label }), h('td', { text: b.kind }), h('td', {}, occupancy), h('td', {}, service), h('td', {}, note, ' ',
            act('Save', status, async () => {
              if (occupancy.value !== b.occupancy) await api('POST', `/api/security/parking/spaces/${encodeURIComponent(b.id)}/occupancy`, { state: occupancy.value, note: note.value });
              if (service.value !== b.serviceability) await api('POST', `/api/security/parking/spaces/${encodeURIComponent(b.id)}/serviceability`, { state: service.value, note: note.value });
            })));
        });
        const chargerRows = desk.chargers.map((c) => h('tr', {}, h('td', { text: c.label }), h('td', { text: `${c.current} ${c.powerKw} kW` }),
          h('td', {}, h('span', { class: `badge ${c.status === 'available' ? 'ok' : 'bad'}`, text: c.status })),
          h('td', {}, c.status === 'available'
            ? act('Report fault', status, () => api('POST', `/api/security/parking/chargers/${encodeURIComponent(c.id)}/fault`), 'small danger')
            : act('Back in service', status, () => api('POST', `/api/security/parking/chargers/${encodeURIComponent(c.id)}/restore`)))));
        baysSlot.replaceChildren(table(['Bay', 'Kind', 'Occupancy', 'Service', ''], bayRows), h('h3', { text: 'Chargers' }), table(['Charger', 'Power', 'Status', ''], chargerRows));
      }

      content.replaceChildren(
        h('section', { class: 'card' }, h('h2', { text: 'Check a parking pass' }), scanSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Alerts' }), alertsSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Inside now' }), insideSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Upcoming visits' }), expectedSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Bays and chargers' }), baysSlot),
      );
      await draw();
    },
  });
})();
