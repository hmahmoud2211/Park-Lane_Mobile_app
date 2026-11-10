/*
 * Amenities (building management): the catalogue (hours, slot length, places, whether one apartment takes the
 * whole slot, the cancellation cut-off) and each day's bookings, which can be cancelled with a reason that goes
 * to the apartment. Talks to /api/admin/amenities and /api/admin/amenity-bookings. Text is only ever set with
 * textContent.
 */
'use strict';

(() => {
  const CATEGORIES = [['sports', 'Sports'], ['leisure', 'Leisure'], ['family', 'Family']];
  const today = () => new Date().toISOString().slice(0, 10);

  window.ParklaneAdmin.register({
    id: 'amenities',
    label: 'Amenities',
    roles: ['admin'],
    async render(content, ui) {
      const { h, api, busy, field } = ui;
      const pictures = await api('GET', '/api/admin/pictures');
      const catalogueSlot = h('div');
      const formSlot = h('div');
      const daySlot = h('div');
      let amenities = [];

      function drawForm(current) {
        const status = h('div');
        const input = (value, attrs = {}) => h('input', { value: value ?? '', ...attrs });
        const title = input(current?.title, { placeholder: 'e.g. Swimming Pool' });
        const location = input(current?.location, { placeholder: 'e.g. Residential Club' });
        const opens = input(current?.opens ?? '08:00', { type: 'time' });
        const closes = input(current?.closes ?? '22:00', { type: 'time' });
        const slot = h('select', { 'aria-label': 'Slot length' }, [30, 60, 90, 120].map((m) => h('option', { value: String(m), text: `${m} minutes`, selected: m === (current?.slotMinutes ?? 60) })));
        const capacity = input(current?.capacity ?? 10, { type: 'number', min: '1', max: '500' });
        const maxPeople = input(current?.maxPeople ?? 6, { type: 'number', min: '1', max: '50' });
        const cutoff = input(current?.cancelCutoffHours ?? 2, { type: 'number', min: '0', max: '72' });
        const exclusive = h('input', { type: 'checkbox', checked: Boolean(current?.exclusive), 'aria-label': 'One apartment at a time' });
        const active = h('input', { type: 'checkbox', checked: current ? current.active : true, 'aria-label': 'Open for booking' });
        const boxes = CATEGORIES.map(([id, label]) => [id, h('input', { type: 'checkbox', checked: current ? current.categories.includes(id) : id === 'leisure', 'aria-label': label }), label]);
        const picture = h('select', { 'aria-label': 'Picture' }, h('option', { value: '', text: 'No picture' }), pictures.map((p) => h('option', { value: p, text: p, selected: p === current?.picture })));
        const save = h('button', { class: 'btn primary', text: current ? 'Save changes' : 'Add amenity' });
        save.addEventListener('click', () => busy(save, status, async () => {
          const body = {
            title: title.value, location: location.value, opens: opens.value, closes: closes.value, slotMinutes: Number(slot.value),
            capacity: Number(capacity.value), maxPeople: Number(maxPeople.value), cancelCutoffHours: Number(cutoff.value),
            exclusive: exclusive.checked, active: active.checked, picture: picture.value || null,
            categories: boxes.filter(([, box]) => box.checked).map(([id]) => id),
          };
          if (current) await api('PUT', `/api/admin/amenities/${encodeURIComponent(current.id)}`, body);
          else await api('POST', '/api/admin/amenities', body);
          await drawCatalogue();
          drawForm(null);
        }));
        formSlot.replaceChildren(
          h('h3', { text: current ? `Edit ${current.title}` : 'New amenity' }),
          h('div', { class: 'row' }, field('Title', title), field('Location', location), field('Picture', picture)),
          h('div', { class: 'row' }, field('Opens', opens), field('Closes', closes), field('Slot', slot)),
          h('div', { class: 'row' }, field('Places at once', capacity), field('People per booking', maxPeople), field('Cancel up to (hours before)', cutoff)),
          h('div', { class: 'row' }, h('label', { class: 'check' }, exclusive, ' One apartment at a time (e.g. a court)'), h('label', { class: 'check' }, active, ' Open for booking'),
            ...boxes.map(([, box, label]) => h('label', { class: 'check' }, box, ` ${label}`))),
          h('div', { class: 'row' }, save, current ? (() => { const cancel = h('button', { class: 'btn', text: 'Cancel' }); cancel.addEventListener('click', () => drawForm(null)); return cancel; })() : null),
          status,
        );
      }

      async function drawCatalogue() {
        amenities = await api('GET', '/api/admin/amenities');
        const rows = amenities.map((a) => {
          const edit = h('button', { class: 'btn small', text: 'Edit' });
          edit.addEventListener('click', () => { drawForm(a); formSlot.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
          return h('tr', {}, h('td', { text: a.title }), h('td', { text: a.location }), h('td', { text: `${a.opens}–${a.closes} · ${a.slotMinutes} min` }),
            h('td', { text: a.exclusive ? 'One apartment' : `${a.capacity} places` }),
            h('td', {}, h('span', { class: `badge ${a.active ? 'ok' : ''}`, text: a.active ? 'Open' : 'Off' })), h('td', {}, edit));
        });
        catalogueSlot.replaceChildren(rows.length
          ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Amenity', 'Location', 'Hours', 'Places', 'Booking', ''].map((t) => h('th', { text: t })))), h('tbody', {}, rows)))
          : h('p', { class: 'muted', text: 'No amenities yet. Add the first one below.' }));
        drawDay();
      }

      async function drawDay(selected, date = today()) {
        const status = h('div');
        const pick = h('select', { 'aria-label': 'Amenity' }, amenities.map((a) => h('option', { value: a.id, text: a.title, selected: a.id === selected })));
        const day = h('input', { type: 'date', value: date });
        const list = h('div');
        const load = async () => {
          if (!pick.value) return;
          const answer = await api('GET', `/api/admin/amenities/${encodeURIComponent(pick.value)}/bookings?date=${day.value}`);
          const rows = answer.bookings.map((b) => {
            const note = h('input', { placeholder: 'Reason (sent to the apartment)', 'aria-label': `Reason for cancelling ${b.reference}` });
            const cancel = h('button', { class: 'btn small danger', text: 'Cancel booking' });
            cancel.addEventListener('click', () => busy(cancel, status, async () => { await api('POST', `/api/admin/amenity-bookings/${encodeURIComponent(b.id)}/cancel`, { note: note.value }); load(); }));
            return h('tr', {}, h('td', { text: `${b.start}–${b.end}` }), h('td', { text: b.unitName }), h('td', { text: String(b.people) }), h('td', { text: b.reference }),
              h('td', {}, h('span', { class: `badge ${b.status === 'booked' ? 'ok' : 'bad'}`, text: b.status })), h('td', {}, b.status === 'booked' ? [note, ' ', cancel] : null));
          });
          list.replaceChildren(rows.length
            ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Time', 'Apartment', 'People', 'Reference', 'Status', ''].map((t) => h('th', { text: t })))), h('tbody', {}, rows)))
            : h('p', { class: 'muted', text: 'No bookings that day.' }));
        };
        pick.addEventListener('change', load);
        day.addEventListener('change', load);
        daySlot.replaceChildren(amenities.length ? h('div', { class: 'row' }, field('Amenity', pick), field('Day', day)) : null, status, list);
        await load();
      }

      content.replaceChildren(
        h('section', { class: 'card' }, h('h2', { text: 'Amenities' }), catalogueSlot, formSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Bookings by day' }), daySlot),
      );
      drawForm(null);
      await drawCatalogue();
    },
  });
})();
