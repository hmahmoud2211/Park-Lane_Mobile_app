/*
 * Building management's rules for the compound (GET | PUT /api/admin/sites/:id/settings): the emergency number
 * Maintenance's button calls (hidden in the app while unset), how residents reach management, visiting hours,
 * maintenance visit windows and amenity limits. Text is only ever set with textContent.
 */
'use strict';

(() => {
  window.ParklaneAdmin.register({
    id: 'site-settings',
    label: 'Compound rules',
    roles: ['admin'],
    async render(content, ui) {
      const { h, api, notice, busy, field } = ui;
      const sites = await api('GET', '/api/admin/sites');
      const site = sites[0];
      if (!site) {
        content.replaceChildren(notice('info', 'No compound is set up.'));
        return;
      }
      const s = site.settings;
      const input = (value, attrs = {}) => h('input', { value: value ?? '', ...attrs });
      const number = (value, min, max) => input(String(value), { type: 'number', min: String(min), max: String(max) });
      const emergency = input(s.emergencyPhone, { type: 'tel', placeholder: 'e.g. +20 2 1234 5678' });
      const phone = input(s.managementPhone, { type: 'tel' });
      const email = input(s.managementEmail, { type: 'email' });
      const earliest = input(s.visitors.earliest, { type: 'time' });
      const latest = input(s.visitors.latest, { type: 'time' });
      const windowDays = number(s.visitors.windowDays, 1, 90);
      const maxGuests = number(s.visitors.maxGuests, 1, 50);
      const retention = number(s.visitors.retentionDays, 7, 730);
      const windows = input(s.maintenance.windows.map((w) => `${w.from}-${w.to}`).join(', '), { placeholder: '09:00-12:00, 12:00-15:00' });
      const leadDays = number(s.maintenance.leadDays, 0, 14);
      const horizonDays = number(s.maintenance.horizonDays, 1, 90);
      const amenityDays = number(s.amenities.windowDays, 1, 90);
      const amenityGuests = number(s.amenities.maxGuests, 0, 50);
      const status = h('div');
      const save = h('button', { class: 'btn primary', text: 'Save rules' });
      save.addEventListener('click', () =>
        busy(save, status, async () => {
          const parsedWindows = windows.value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
              const [from, to] = part.split('-').map((t) => t.trim());
              return { from, to };
            });
          await api('PUT', `/api/admin/sites/${encodeURIComponent(site.id)}/settings`, {
            emergencyPhone: emergency.value.trim() || null,
            managementPhone: phone.value.trim() || null,
            managementEmail: email.value.trim() || null,
            visitors: {
              earliest: earliest.value,
              latest: latest.value,
              windowDays: Number(windowDays.value),
              maxGuests: Number(maxGuests.value),
              retentionDays: Number(retention.value),
            },
            maintenance: { windows: parsedWindows, leadDays: Number(leadDays.value), horizonDays: Number(horizonDays.value) },
            amenities: { windowDays: Number(amenityDays.value), maxGuests: Number(amenityGuests.value) },
          });
          status.replaceChildren(notice('ok', 'Saved. Residents see the new rules the next time their app loads them.'));
        }),
      );
      content.replaceChildren(
        h('section', { class: 'card' },
          h('h2', { text: `${site.name} · contacts` }),
          h('div', { class: 'row' },
            field('Emergency number', emergency, 'Maintenance\'s "Call now" button dials it. Leave empty to hide the button.'),
            field('Management phone', phone),
            field('Management email', email),
          ),
        ),
        h('section', { class: 'card' },
          h('h2', { text: 'Visitor passes' }),
          h('div', { class: 'row' },
            field('First arrival', earliest), field('Last arrival', latest), field('Days ahead', windowDays),
            field('Most guests', maxGuests), field('Delete past passes after (days)', retention),
          ),
        ),
        h('section', { class: 'card' },
          h('h2', { text: 'Maintenance visits' }),
          h('div', { class: 'row' },
            field('Visit windows', windows, 'Comma-separated, e.g. 09:00-12:00, 12:00-15:00'),
            field('Earliest day (days from today)', leadDays), field('Latest day (days ahead)', horizonDays),
          ),
        ),
        h('section', { class: 'card' },
          h('h2', { text: 'Amenities' }),
          h('div', { class: 'row' }, field('Days ahead', amenityDays), field('Most guests per booking', amenityGuests)),
        ),
        status,
        save,
      );
    },
  });
})();
