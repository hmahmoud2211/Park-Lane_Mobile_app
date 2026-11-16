/*
 * The clinic (building management): the doctors residents can book, with their sign-in, profile and weekly hours,
 * and the specialties they practise. A new doctor gets a temporary password, shown once, which they replace at their
 * first sign-in to the clinic web app. Talks to /api/admin/clinic (backend/src/clinic/admin.ts). Text is only ever
 * set with textContent.
 */
'use strict';

(() => {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  /** The languages the resident app can name; other codes a doctor already has are kept as they are. */
  const LANGUAGES = [['en', 'English'], ['ar', 'Arabic']];
  const VISIT_LENGTHS = [10, 15, 20, 30, 45, 60];

  const hoursText = (schedule) =>
    schedule.length ? schedule.map((block) => `${SHORT_DAYS[block.weekday]} ${block.start}–${block.end}`).join(', ') : 'No hours yet';

  window.ParklaneAdmin.register({
    id: 'clinic',
    label: 'Clinic',
    roles: ['admin'],
    async render(content, ui) {
      const { h, api, busy, field, confirmAction, showOnce, notice } = ui;
      const formSlot = h('div');
      const doctorsSlot = h('div');
      const specialtiesSlot = h('div');
      let clinic = { specialties: [], doctors: [] };

      async function reload() {
        clinic = await api('GET', '/api/admin/clinic');
        drawDoctors();
        drawSpecialties();
      }

      /** Rows of day / from / to. "Add hours" proposes the next day with the same times, so Sunday to Thursday is quick. */
      function hoursEditor(initial) {
        const rows = [];
        const list = h('div');
        const empty = h('p', { class: 'hint', text: 'No hours yet. Residents see this doctor but cannot book until you add hours.' });
        const syncEmpty = () => (empty.hidden = rows.length > 0);
        function addRow(block) {
          const day = h('select', { 'aria-label': 'Day' }, DAYS.map((name, index) => h('option', { value: String(index), text: name, selected: index === block.weekday })));
          const start = h('input', { type: 'time', value: block.start, 'aria-label': 'From' });
          const end = h('input', { type: 'time', value: block.end, 'aria-label': 'To' });
          const remove = h('button', { class: 'btn small', type: 'button', text: 'Remove' });
          const row = h('div', { class: 'hours-row' }, day, start, h('span', { class: 'muted hours-to', text: 'to' }), end, remove);
          const entry = { read: () => ({ weekday: Number(day.value), start: start.value, end: end.value }) };
          remove.addEventListener('click', () => {
            rows.splice(rows.indexOf(entry), 1);
            row.remove();
            syncEmpty();
          });
          rows.push(entry);
          list.append(row);
          syncEmpty();
        }
        const add = h('button', { class: 'btn small', type: 'button', text: '+ Add hours' });
        add.addEventListener('click', () => {
          const last = rows.at(-1)?.read();
          addRow(last ? { weekday: (last.weekday + 1) % 7, start: last.start, end: last.end } : { weekday: 0, start: '09:00', end: '13:00' });
        });
        initial.forEach(addRow);
        syncEmpty();
        return { element: h('div', {}, list, empty, h('div', { class: 'actions start' }, add)), read: () => rows.map((entry) => entry.read()) };
      }

      function drawForm(current) {
        const status = h('div');
        const input = (value, attrs = {}) => h('input', { value: value ?? '', ...attrs });
        const area = (value, attrs = {}) => {
          const element = h('textarea', { rows: '3', ...attrs });
          element.value = value ?? '';
          return element;
        };
        const arabic = { dir: 'rtl', lang: 'ar' };
        const email = input(current?.email, { type: 'email', placeholder: 'doctor@example.com', autocomplete: 'off', disabled: Boolean(current) });
        const name = input(current?.name, { placeholder: 'e.g. Dr. Karim Hassan' });
        const nameAr = input(current?.nameAr, { placeholder: 'د. كريم حسن', ...arabic });
        // A new doctor starts on "Choose…", so nobody is filed under the first specialty by accident.
        const specialty = h(
          'select',
          { 'aria-label': 'Specialty' },
          current ? null : h('option', { value: '', text: 'Choose a specialty…', selected: true }),
          clinic.specialties.map((entry) => h('option', { value: entry.id, text: entry.en, selected: entry.id === current?.specialtyId })),
        );
        const title = input(current?.title, { placeholder: 'e.g. Consultant Cardiologist' });
        const titleAr = input(current?.titleAr, { placeholder: 'استشاري أمراض القلب', ...arabic });
        const chosenLength = current?.consultationMinutes ?? 20;
        const lengths = VISIT_LENGTHS.includes(chosenLength) ? VISIT_LENGTHS : [...VISIT_LENGTHS, chosenLength].sort((a, b) => a - b);
        const minutes = h('select', { 'aria-label': 'Visit length' }, lengths.map((m) => h('option', { value: String(m), text: `${m} minutes`, selected: m === chosenLength })));
        const years = input(current?.yearsExperience, { type: 'number', min: '0', max: '70', placeholder: 'e.g. 12' });
        const fee = input(current?.feeEgp, { type: 'number', min: '0', max: '100000', placeholder: 'e.g. 600' });
        const languageBoxes = LANGUAGES.map(([code, label]) => [code, h('input', { type: 'checkbox', checked: current ? current.languages.includes(code) : true, 'aria-label': label }), label]);
        const bio = area(current?.bio, { placeholder: 'What residents read under "About", e.g. heart rhythm and blood pressure.' });
        const bioAr = area(current?.bioAr, arabic);
        const hours = hoursEditor(current ? current.schedule : []);
        const wholeOrNull = (element) => (element.value.trim() === '' ? null : Number(element.value));
        const save = h('button', { class: 'btn primary', type: 'submit', text: current ? 'Save changes' : 'Add doctor' });
        const cancel = h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => formSlot.replaceChildren() });

        const form = h(
          'form',
          {
            onsubmit: (event) => {
              event.preventDefault();
              busy(save, status, async () => {
                const kept = (current?.languages ?? []).filter((code) => !LANGUAGES.some(([known]) => known === code));
                const body = {
                  name: name.value,
                  nameAr: nameAr.value,
                  specialtyId: specialty.value,
                  title: title.value,
                  titleAr: titleAr.value,
                  consultationMinutes: Number(minutes.value),
                  yearsExperience: wholeOrNull(years),
                  feeEgp: wholeOrNull(fee),
                  languages: [...kept, ...languageBoxes.filter(([, box]) => box.checked).map(([code]) => code)],
                  bio: bio.value,
                  bioAr: bioAr.value,
                  schedule: hours.read(),
                };
                if (current) {
                  const saved = await api('PATCH', `/api/admin/clinic/doctors/${encodeURIComponent(current.id)}`, body);
                  formSlot.replaceChildren(notice('ok', `Saved ${saved.name}.`));
                } else {
                  const created = await api('POST', '/api/admin/clinic/doctors', { email: email.value, ...body });
                  const bookable = created.doctor.schedule.length > 0;
                  formSlot.replaceChildren(
                    notice('ok', bookable ? `${created.doctor.name} is added. Residents can book them in the app now.` : `${created.doctor.name} is added. Add their weekly hours so residents can book them.`),
                  );
                  showOnce(
                    'Temporary password',
                    `Give this to ${created.doctor.name} with their sign-in email (${created.doctor.email}). It is shown only now.`,
                    created.temporaryPassword,
                    'They sign in to the clinic web app with it and choose their own password.',
                  );
                }
                await reload();
              });
            },
          },
          h('h2', { text: current ? `Edit ${current.name}` : 'New doctor' }),
          current
            ? h('p', { class: 'muted', text: 'Changes show in the app straight away. New hours do not move appointments already booked.' })
            : h('p', { class: 'muted', text: 'The doctor gets a sign-in for the clinic web app with a temporary password, shown once. At the first sign-in they choose their own.' }),
          h('div', { class: 'row' }, field('Sign-in email', email, current ? 'Cannot be changed here.' : null), field('Name (English)', name), field('Name (Arabic)', nameAr)),
          h('div', { class: 'row' }, field('Specialty', specialty), field('Title (English)', title), field('Title (Arabic)', titleAr)),
          h('div', { class: 'row' }, field('Visit length', minutes), field('Years of experience', years), field('Fee (EGP)', fee)),
          h('div', { class: 'row' }, ...languageBoxes.map(([, box, label]) => h('label', { class: 'check' }, box, ` Speaks ${label}`))),
          h('div', { class: 'row' }, field('About (English)', bio), field('About (Arabic)', bioAr)),
          h('h3', { text: 'Weekly hours' }),
          h('p', { class: 'hint', text: 'In the clinic’s time. Residents book visits of the length above inside these hours.' }),
          hours.element,
          status,
          h('div', { class: 'actions' }, cancel, save),
        );
        formSlot.replaceChildren(h('section', { class: 'card' }, form));
        formSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      async function toggle(doctor, button, status) {
        if (doctor.active) {
          const sure = await confirmAction(
            `Turn off ${doctor.name}?`,
            'Residents can no longer book them, and they cannot open the clinic web app. Appointments already booked stay: ask the front desk to move or cancel them.',
            'Turn off',
          );
          if (!sure) return;
        }
        await busy(button, status, async () => {
          await api('POST', `/api/admin/clinic/doctors/${encodeURIComponent(doctor.id)}/active`, { active: !doctor.active });
          await reload();
        });
      }

      function drawDoctors() {
        const status = h('div');
        const add = h('button', { class: 'btn primary', type: 'button', text: 'Add doctor', disabled: clinic.specialties.length === 0, onclick: () => drawForm(null) });
        const rows = clinic.doctors.map((doctor) => {
          const edit = h('button', { class: 'btn small', type: 'button', text: 'Edit', onclick: () => drawForm(doctor) });
          const onOff = h('button', { class: `btn small ${doctor.active ? 'danger' : ''}`, type: 'button', text: doctor.active ? 'Turn off' : 'Turn on' });
          onOff.addEventListener('click', () => toggle(doctor, onOff, status));
          return h(
            'tr',
            {},
            h(
              'td',
              {},
              doctor.name,
              doctor.title ? h('div', { class: 'hint', text: doctor.title }) : null,
              doctor.mustChangePassword ? h('div', {}, h('span', { class: 'badge warn', text: 'Temporary password' })) : null,
            ),
            h('td', { text: doctor.specialty.en }),
            h('td', {}, hoursText(doctor.schedule), h('div', { class: 'hint', text: `${doctor.consultationMinutes}-minute visits` })),
            h('td', { class: 'mono', text: doctor.email }),
            h('td', {}, h('span', { class: `badge ${doctor.active ? 'ok' : ''}`, text: doctor.active ? 'Bookable' : 'Off' })),
            h('td', { class: 'right nowrap' }, edit, ' ', onOff),
          );
        });
        // Built with h(), which skips the empty parts; replaceChildren alone would print them as "null".
        doctorsSlot.replaceChildren(h(
          'div',
          {},
          h('div', { class: 'toolbar' }, h('h2', { text: 'Doctors' }), add),
          clinic.specialties.length === 0 ? notice('ok', 'Add a specialty first (below), for example General Medicine. Every doctor belongs to one.') : null,
          rows.length
            ? h(
                'div',
                { class: 'table-wrap' },
                h('table', {}, h('thead', {}, h('tr', {}, ['Doctor', 'Specialty', 'Weekly hours', 'Sign-in', 'Status', ''].map((text) => h('th', { text })))), h('tbody', {}, rows)),
              )
            : h('p', { class: 'muted', text: 'No doctors yet.' }),
          status,
          h('p', { class: 'hint', text: 'A doctor who forgot their password: use Reset password in Accounts. Photos and time off are set with the clinic CLI on the server.' }),
        ));
      }

      function drawSpecialties() {
        const status = h('div');
        const en = h('input', { placeholder: 'e.g. Dermatology', 'aria-label': 'English name' });
        const ar = h('input', { placeholder: 'الأمراض الجلدية', 'aria-label': 'Arabic name', dir: 'rtl', lang: 'ar' });
        const add = h('button', { class: 'btn', type: 'submit', text: 'Add specialty' });
        const form = h(
          'form',
          {
            onsubmit: (event) => {
              event.preventDefault();
              busy(add, status, async () => {
                await api('POST', '/api/admin/clinic/specialties', { en: en.value, ar: ar.value });
                await reload();
              });
            },
          },
          h('div', { class: 'row' }, field('English name', en), field('Arabic name', ar, 'Optional. Without it, Arabic readers see the English name.'), add),
          status,
        );
        const rows = clinic.specialties.map((entry) =>
          h('tr', {}, h('td', { text: entry.en }), h('td', { text: entry.ar, dir: 'rtl', lang: 'ar' }), h('td', { text: entry.doctors === 1 ? '1 doctor' : `${entry.doctors} doctors` })),
        );
        specialtiesSlot.replaceChildren(
          h('h2', { text: 'Specialties' }),
          rows.length
            ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['English', 'Arabic', 'Doctors'].map((text) => h('th', { text })))), h('tbody', {}, rows)))
            : h('p', { class: 'muted', text: 'No specialties yet.' }),
          form,
        );
      }

      content.replaceChildren(formSlot, h('section', { class: 'card' }, doctorsSlot), h('section', { class: 'card' }, specialtiesSlot));
      await reload();
    },
  });
})();
