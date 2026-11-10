/*
 * Maintenance, housekeeping and moving requests (building management): the queue, one request's details, photos
 * and history, booking a technician and a slot, starting, completing or cancelling it, writing to the resident;
 * the technicians on record and which categories residents may choose. Talks to /api/admin/requests,
 * /api/admin/technicians and /api/admin/service-categories. Text is only ever set with textContent.
 */
'use strict';

(() => {
  const STATUS = {
    submitted: ['warn', 'New'],
    assigned: ['', 'Booked'],
    in_progress: ['', 'In progress'],
    completed: ['ok', 'Completed'],
    cancelled: ['bad', 'Cancelled'],
  };
  const KIND = { maintenance: 'Maintenance', housekeeping: 'Housekeeping', moving: 'Moving' };
  const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const slot = (date, window) => (date ? `${date} · ${(window || '').replace('-', '–')}` : '—');

  window.ParklaneAdmin.register({
    id: 'requests',
    label: 'Requests',
    roles: ['admin'],
    async render(content, ui) {
      const { h, api, notice, busy, field } = ui;
      const sites = await api('GET', '/api/admin/sites');
      const windows = sites[0] ? sites[0].settings.maintenance.windows.map((w) => `${w.from}-${w.to}`) : [];
      let staff = [];

      const statusFilter = h('select', { 'aria-label': 'Status' },
        [['open', 'Open'], ['', 'All'], ['submitted', 'New'], ['assigned', 'Booked'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']]
          .map(([value, text]) => h('option', { value, text })));
      const kindFilter = h('select', { 'aria-label': 'Kind' }, [['', 'Every kind'], ...Object.entries(KIND)].map(([value, text]) => h('option', { value, text })));
      const queueSlot = h('div');
      const detailSlot = h('div');
      const staffSlot = h('div');
      const categorySlot = h('div');
      const badge = (status) => h('span', { class: `badge ${STATUS[status][0]}`, text: STATUS[status][1] });

      async function drawQueue() {
        const query = new URLSearchParams();
        if (statusFilter.value) query.set('status', statusFilter.value);
        if (kindFilter.value) query.set('kind', kindFilter.value);
        const list = await api('GET', `/api/admin/requests?${query}`);
        const rows = list.map((r) => {
          const open = h('button', { class: 'btn small', text: 'Open' });
          open.addEventListener('click', () => drawDetail(r));
          return h('tr', {},
            h('td', { text: r.reference }), h('td', { text: r.unitName }),
            h('td', { text: `${KIND[r.kind]} · ${r.categoryTitle}` }),
            h('td', {}, r.priority === 'urgent' ? h('span', { class: 'badge bad', text: 'Urgent' }) : null, r.priority === 'urgent' ? ' ' : null, r.title),
            h('td', { text: slot(r.preferredDate, r.preferredWindow) }),
            h('td', { text: r.technician ? `${r.technician.name} · ${slot(r.scheduledDate, r.scheduledWindow)}` : '—' }),
            h('td', {}, badge(r.status)), h('td', {}, open));
        });
        queueSlot.replaceChildren(rows.length
          ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Reference', 'Apartment', 'Kind', 'Issue', 'Wanted', 'Booked', 'Status', ''].map((t) => h('th', { text: t })))), h('tbody', {}, rows)))
          : h('p', { class: 'muted', text: 'No requests here.' }));
      }

      function drawDetail(r) {
        const status = h('div');
        const after = async (updated) => { await drawQueue(); drawDetail(updated); };
        const open = ['submitted', 'assigned', 'in_progress'].includes(r.status);

        const technician = h('select', { 'aria-label': 'Technician' }, h('option', { value: '', text: 'Technician' }),
          staff.filter((t) => t.active).map((t) => h('option', { value: t.id, text: `${t.name}${t.trades.length ? ` (${t.trades.join(', ')})` : ''}`, selected: t.id === r.technicianId })));
        const date = h('input', { type: 'date', value: r.scheduledDate || r.preferredDate });
        const visitWindow = h('select', { 'aria-label': 'Window' }, windows.map((w) => h('option', { value: w, text: w.replace('-', '–'), selected: w === (r.scheduledWindow || r.preferredWindow) })));
        const assignNote = h('input', { placeholder: 'Optional note for the resident' });
        const assign = h('button', { class: 'btn primary', text: r.status === 'assigned' ? 'Change booking' : 'Book' });
        assign.addEventListener('click', () => busy(assign, status, async () => {
          after(await api('POST', `/api/admin/requests/${encodeURIComponent(r.id)}/assign`, { technicianId: technician.value, scheduledDate: date.value, scheduledWindow: visitWindow.value, note: assignNote.value.trim() || null }));
        }));

        const note = h('input', { placeholder: 'Note (needed to cancel)' });
        const move = (to, label, cls) => {
          const button = h('button', { class: `btn ${cls}`, text: label });
          button.addEventListener('click', () => busy(button, status, async () => {
            after(await api('POST', `/api/admin/requests/${encodeURIComponent(r.id)}/status`, { status: to, note: note.value.trim() || null }));
          }));
          return button;
        };

        const message = h('input', { placeholder: 'Write to the resident' });
        const send = h('button', { class: 'btn', text: 'Send' });
        send.addEventListener('click', () => busy(send, status, async () => {
          after(await api('POST', `/api/admin/requests/${encodeURIComponent(r.id)}/comments`, { note: message.value }));
        }));

        const timeline = h('ul', {}, r.events.map((e) => h('li', {
          text: `${when(e.at)} · ${e.byStaff ? 'Management' : 'Resident'}: ${e.kind === 'status' ? (STATUS[e.status] || ['', e.status])[1] : 'message'}${e.note ? ` – ${e.note}` : ''}`,
        })));
        const photos = r.photos.length
          ? h('p', {}, r.photos.flatMap((p, i) => [h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: `Photo ${i + 1}` }), ' ']))
          : null;

        detailSlot.replaceChildren(h('section', { class: 'card' },
          h('h2', { text: `${r.reference} · ${r.unitName}` }),
          h('p', {}, badge(r.status), ` ${KIND[r.kind]} · ${r.categoryTitle} · ${r.title}`),
          r.details ? h('p', { text: r.details }) : null,
          h('p', { class: 'muted', text: `Wanted ${slot(r.preferredDate, r.preferredWindow)} · asked ${when(r.createdAt)}` }),
          photos,
          ['submitted', 'assigned'].includes(r.status)
            ? h('div', { class: 'row' }, field('Technician', technician), field('Day', date), field('Window', visitWindow), field('Note', assignNote), assign)
            : null,
          open
            ? h('div', { class: 'row' }, field('Note', note),
                r.status === 'assigned' ? move('in_progress', 'Start', 'primary') : null,
                r.status !== 'submitted' ? move('completed', 'Complete', 'primary') : null,
                move('cancelled', 'Cancel request', 'danger'))
            : null,
          r.status !== 'cancelled' ? h('div', { class: 'row' }, field('Message', message), send) : null,
          status,
          h('h3', { text: 'History' }), timeline,
        ));
        detailSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      async function drawStaff() {
        staff = await api('GET', '/api/admin/technicians');
        const status = h('div');
        const name = h('input', { placeholder: 'Name' });
        const phone = h('input', { type: 'tel', placeholder: 'Phone (shown to the resident once booked)' });
        const trades = h('input', { placeholder: 'e.g. plumbing, electrical, housekeeping' });
        const add = h('button', { class: 'btn primary', text: 'Add technician' });
        const tradesOf = (text) => text.split(',').map((t) => t.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
        add.addEventListener('click', () => busy(add, status, async () => {
          await api('POST', '/api/admin/technicians', { name: name.value, phone: phone.value, trades: tradesOf(trades.value) });
          drawStaff();
        }));
        const rows = staff.map((t) => {
          const toggle = h('button', { class: 'btn small', text: t.active ? 'Set inactive' : 'Set active' });
          toggle.addEventListener('click', () => busy(toggle, status, async () => {
            await api('PUT', `/api/admin/technicians/${encodeURIComponent(t.id)}`, { active: !t.active });
            drawStaff();
          }));
          return h('tr', {}, h('td', { text: t.name }), h('td', { text: t.phone || '—' }), h('td', { text: t.trades.join(', ') || '—' }),
            h('td', {}, h('span', { class: `badge ${t.active ? 'ok' : ''}`, text: t.active ? 'Active' : 'Inactive' })), h('td', {}, toggle));
        });
        staffSlot.replaceChildren(
          h('div', { class: 'row' }, field('Name', name), field('Phone', phone), field('Trades', trades), add), status,
          rows.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Phone', 'Trades', 'Status', ''].map((t) => h('th', { text: t })))), h('tbody', {}, rows)))
            : h('p', { class: 'muted', text: 'No technicians yet. Add one to book visits.' }),
        );
      }

      async function drawCategories() {
        const list = await api('GET', '/api/admin/service-categories');
        const status = h('div');
        const groups = Object.keys(KIND).map((kind) => h('div', {}, h('h3', { text: KIND[kind] }), h('div', { class: 'row' }, list.filter((c) => c.kind === kind).map((c) => {
          const box = h('input', { type: 'checkbox', checked: c.active, 'aria-label': c.title });
          box.addEventListener('change', () => busy(box, status, async () => {
            await api('PUT', `/api/admin/service-categories/${encodeURIComponent(c.kind)}/${encodeURIComponent(c.id)}`, { active: box.checked });
          }));
          return h('label', { class: 'check' }, box, ` ${c.title}`);
        }))));
        categorySlot.replaceChildren(h('p', { class: 'muted', text: 'Residents can choose the ticked categories.' }), ...groups, status);
      }

      statusFilter.addEventListener('change', drawQueue);
      kindFilter.addEventListener('change', drawQueue);
      content.replaceChildren(
        h('section', { class: 'card' }, h('h2', { text: 'Requests' }), h('div', { class: 'row' }, field('Status', statusFilter), field('Kind', kindFilter)), queueSlot),
        detailSlot,
        h('section', { class: 'card' }, h('h2', { text: 'Technicians' }), staffSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Categories' }), categorySlot),
      );
      await Promise.all([drawQueue(), drawStaff(), drawCategories()]);
    },
  });
})();
