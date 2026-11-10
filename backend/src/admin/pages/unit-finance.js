/*
 * My Unit and Bills, as building management keeps them (/api/admin/units/:id/...): an apartment's details, its
 * contract and payment schedule, bills, the payments received (each gets a receipt number from the server), meter
 * readings and documents. Amounts are typed in EGP and sent in piastres. Text is only ever set with textContent.
 */
'use strict';

(() => {
  const egp = (piastres) => `EGP ${(piastres / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const toPiastres = (value) => Math.round(Number(String(value).replace(/[, ]/g, '')) * 100);
  const STATUS = { paid: 'ok', partial: 'warn', due: '', overdue: 'bad', void: '' };

  window.ParklaneAdmin.register({
    id: 'unit-finance',
    label: 'Unit finance',
    roles: ['admin'],
    async render(content, ui) {
      const { h, api, notice, busy, field, confirmAction } = ui;
      const units = await api('GET', '/api/admin/units');
      const picker = h('select', { 'aria-label': 'Apartment' }, h('option', { value: '', text: 'Choose an apartment' }), units.map((unit) => h('option', { value: unit.id, text: unit.name })));
      const detail = h('div');
      picker.addEventListener('change', () => (picker.value ? openUnit(picker.value) : detail.replaceChildren()));
      content.replaceChildren(h('section', { class: 'card' }, h('h2', { text: 'Apartment' }), picker), detail);

      async function openUnit(unitId) {
        detail.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
        const data = await api('GET', `/api/admin/units/${encodeURIComponent(unitId)}/finance`);
        const reload = () => openUnit(unitId);
        detail.replaceChildren(
          detailsCard(unitId, data.details || {}),
          summaryCard(data.summary),
          contractCard(unitId, data.contracts, reload),
          chargesCard(unitId, data.charges, reload),
          paymentCard(unitId, data.charges, data.payments, reload),
          metersCard(unitId, data.meters, reload),
          documentsCard(unitId, data.documents, reload),
        );
      }

      function detailsCard(unitId, d) {
        const inputs = {
          tower: h('input', { value: d.tower ?? '' }),
          floor: h('input', { type: 'number', value: d.floor ?? '' }),
          number: h('input', { value: d.number ?? '' }),
          unitType: h('input', { value: d.unitType ?? '', placeholder: 'Apartment, Villa…' }),
          bedrooms: h('input', { type: 'number', value: d.bedrooms ?? '' }),
          bathrooms: h('input', { type: 'number', value: d.bathrooms ?? '' }),
          areaM2: h('input', { type: 'number', value: d.areaM2 ?? '' }),
          parkingBay: h('input', { value: d.parkingBay ?? '' }),
          handoverStatus: h('input', { value: d.handoverStatus ?? '', placeholder: 'Handed over, Pending…' }),
        };
        const status = h('div');
        const save = h('button', { class: 'btn primary', text: 'Save details' });
        save.addEventListener('click', () =>
          busy(save, status, async () => {
            const num = (input) => (input.value === '' ? null : Number(input.value));
            await api('PUT', `/api/admin/units/${encodeURIComponent(unitId)}/details`, {
              tower: inputs.tower.value, floor: num(inputs.floor), number: inputs.number.value, unitType: inputs.unitType.value,
              bedrooms: num(inputs.bedrooms), bathrooms: num(inputs.bathrooms), areaM2: num(inputs.areaM2), parkingBay: inputs.parkingBay.value,
              handoverStatus: inputs.handoverStatus.value,
            });
            status.replaceChildren(notice('ok', 'Saved.'));
          }),
        );
        return h('section', { class: 'card' }, h('h2', { text: 'Details' }),
          h('div', { class: 'row' }, ...Object.entries(inputs).map(([key, input]) => field(key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), input))),
          status, save);
      }

      function summaryCard(s) {
        const c = s.contract;
        return h('section', { class: 'card' }, h('h2', { text: 'What the owner sees' }),
          h('p', { text: c ? `Contract ${egp(c.price)} · paid ${egp(c.paid)} · remaining ${egp(c.remaining)} (${Math.round(c.paidRatio * 100)}%)` : 'No contract yet.' }),
          h('p', { text: s.nextInstallment ? `Next: ${s.nextInstallment.title}, ${egp(s.nextInstallment.outstanding)} due ${s.nextInstallment.dueOn} · ${s.remainingInstallments} installments left` : 'No installment due.' }),
          h('p', { text: `Service charges ${s.serviceCharges.year}: ${egp(s.serviceCharges.total)}, outstanding ${egp(s.serviceCharges.outstanding)}` }));
      }

      function contractCard(unitId, contracts, reload) {
        const kind = h('select', {}, h('option', { value: 'sale', text: 'Sale' }), h('option', { value: 'lease', text: 'Lease' }));
        const price = h('input', { placeholder: 'e.g. 8500000' });
        const signed = h('input', { type: 'date' });
        const down = h('input', { placeholder: 'Down payment (EGP)' });
        const downDue = h('input', { type: 'date' });
        const count = h('input', { type: 'number', placeholder: 'e.g. 30' });
        const first = h('input', { type: 'date' });
        const every = h('input', { type: 'number', value: '1' });
        const status = h('div');
        const add = h('button', { class: 'btn primary', text: 'Add contract and schedule' });
        add.addEventListener('click', () =>
          busy(add, status, async () => {
            const schedule = count.value || down.value ? {
              downPayment: down.value ? toPiastres(down.value) : null, downPaymentDueOn: downDue.value || first.value,
              installments: count.value ? Number(count.value) : 0, firstDueOn: first.value, everyMonths: Number(every.value || 1),
            } : null;
            await api('POST', `/api/admin/units/${encodeURIComponent(unitId)}/contracts`, { kind: kind.value, price: toPiastres(price.value), signedOn: signed.value || null, schedule });
            reload();
          }),
        );
        return h('section', { class: 'card' }, h('h2', { text: 'Contract' }),
          contracts.length ? h('p', { class: 'muted', text: contracts.map((c) => `${c.kind} ${egp(c.price)}${c.signed_on ? `, signed ${c.signed_on}` : ''}`).join(' · ') }) : null,
          h('div', { class: 'row' }, field('Kind', kind), field('Price (EGP)', price), field('Signed on', signed)),
          h('div', { class: 'row' }, field('Down payment (EGP)', down), field('Down payment due', downDue), field('Installments', count), field('First due', first), field('Every (months)', every)),
          status, add);
      }

      function chargesCard(unitId, charges, reload) {
        const kind = h('select', {}, ['service_charge', 'electricity', 'water', 'gas', 'other'].map((k) => h('option', { value: k, text: k.replace('_', ' ') })));
        const title = h('input', { placeholder: 'e.g. Service charge Q1' });
        const period = h('input', { type: 'month' });
        const due = h('input', { type: 'date' });
        const value = h('input', { placeholder: 'EGP' });
        const status = h('div');
        const add = h('button', { class: 'btn', text: 'Add bill' });
        add.addEventListener('click', () =>
          busy(add, status, async () => {
            await api('POST', `/api/admin/units/${encodeURIComponent(unitId)}/charges`, { kind: kind.value, title: title.value, period: period.value || null, dueOn: due.value, amount: toPiastres(value.value) });
            reload();
          }),
        );
        const rows = charges.slice().reverse().map((charge) => {
          const voidButton = charge.status !== 'void' && charge.paid === 0 ? h('button', { class: 'btn small danger', text: 'Cancel' }) : null;
          voidButton?.addEventListener('click', async () => {
            if (!(await confirmAction('Cancel this charge?', `${charge.title} (${egp(charge.amount)}) will no longer be owed.`, 'Cancel charge'))) return;
            await busy(voidButton, status, async () => { await api('POST', `/api/admin/charges/${encodeURIComponent(charge.id)}/void`); reload(); });
          });
          return h('tr', {}, h('td', { text: charge.reference }), h('td', { text: charge.title }), h('td', { text: charge.dueOn }), h('td', { text: egp(charge.amount) }),
            h('td', { text: egp(charge.outstanding) }), h('td', {}, h('span', { class: `badge ${STATUS[charge.status] || ''}`, text: charge.status })), h('td', {}, voidButton));
        });
        return h('section', { class: 'card' }, h('h2', { text: 'Charges' }),
          h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Reference', 'Title', 'Due', 'Amount', 'Left', 'Status', ''].map((t) => h('th', { text: t })))), h('tbody', {}, rows))),
          h('div', { class: 'row' }, field('Kind', kind), field('Title', title), field('Month', period), field('Due on', due), field('Amount (EGP)', value), add), status);
      }

      function paymentCard(unitId, charges, payments, reload) {
        const open = charges.filter((charge) => charge.status !== 'void' && charge.outstanding > 0);
        const charge = h('select', {}, h('option', { value: '', text: 'Not for a specific charge' }), open.map((c) => h('option', { value: c.id, text: `${c.title} · ${egp(c.outstanding)} left` })));
        const value = h('input', { placeholder: 'EGP' });
        charge.addEventListener('change', () => { const c = open.find((x) => x.id === charge.value); if (c) value.value = String(c.outstanding / 100); });
        const paidOn = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
        const method = h('select', {}, [['bank_transfer', 'Bank transfer'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card_at_office', 'Card at the office']].map(([v, t]) => h('option', { value: v, text: t })));
        const note = h('input', { placeholder: 'Optional note' });
        const status = h('div');
        const record = h('button', { class: 'btn primary', text: 'Record payment' });
        record.addEventListener('click', () =>
          busy(record, status, async () => {
            const payment = await api('POST', `/api/admin/units/${encodeURIComponent(unitId)}/payments`, { chargeId: charge.value || null, amount: toPiastres(value.value), paidOn: paidOn.value, method: method.value, note: note.value || null });
            status.replaceChildren(notice('ok', `Recorded. Receipt ${payment.receiptNo}.`));
            setTimeout(reload, 900);
          }),
        );
        return h('section', { class: 'card' }, h('h2', { text: 'Payments received' }),
          payments.length ? h('ul', {}, payments.slice(0, 12).map((p) => h('li', { text: `${p.paid_on} · ${egp(p.amount)} · ${p.method.replace(/_/g, ' ')} · ${p.receipt_no}${p.charge_title ? ` · ${p.charge_title}` : ''}` }))) : h('p', { class: 'muted', text: 'No payments yet.' }),
          h('div', { class: 'row' }, field('For', charge), field('Amount (EGP)', value), field('Paid on', paidOn), field('Method', method), field('Note', note), record), status);
      }

      function metersCard(unitId, meters, reload) {
        const meter = h('select', {}, ['electricity', 'water', 'gas'].map((m) => h('option', { value: m, text: m })));
        const period = h('input', { type: 'month' });
        const value = h('input', { type: 'number', step: 'any', placeholder: 'kWh or m³' });
        const status = h('div');
        const save = h('button', { class: 'btn', text: 'Save reading' });
        save.addEventListener('click', () =>
          busy(save, status, async () => {
            await api('PUT', `/api/admin/units/${encodeURIComponent(unitId)}/meters`, { readings: [{ meter: meter.value, period: period.value, value: Number(value.value) }] });
            reload();
          }),
        );
        return h('section', { class: 'card' }, h('h2', { text: 'Meter readings' }),
          meters.length ? h('p', { class: 'muted', text: meters.slice(0, 9).map((m) => `${m.period} ${m.meter} ${m.value}`).join(' · ') }) : null,
          h('div', { class: 'row' }, field('Meter', meter), field('Month', period), field('Reading', value), save), status);
      }

      function documentsCard(unitId, documents, reload) {
        const kind = h('select', {}, [['floor_plan', 'Floor plan'], ['contract_scan', 'Contract scan'], ['other', 'Other']].map(([v, t]) => h('option', { value: v, text: t })));
        const title = h('input', { placeholder: 'e.g. Floor plan, level 3' });
        const file = h('input', { type: 'file', accept: 'application/pdf,image/png,image/jpeg' });
        const status = h('div');
        const upload = h('button', { class: 'btn', text: 'Upload' });
        upload.addEventListener('click', () =>
          busy(upload, status, async () => {
            const chosen = file.files && file.files[0];
            if (!chosen) throw new ui.ApiError(400, 'bad_request', 'Choose a file.');
            const response = await fetch(`/api/admin/units/${encodeURIComponent(unitId)}/documents?kind=${encodeURIComponent(kind.value)}&title=${encodeURIComponent(title.value)}`, {
              method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('ems-admin-session') || ''}` }, body: chosen,
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.ok) throw new ui.ApiError(response.status, payload?.error?.code || 'error', payload?.error?.message || 'Upload failed.');
            reload();
          }),
        );
        const rows = documents.map((doc) => {
          const remove = h('button', { class: 'btn small danger', text: 'Delete' });
          remove.addEventListener('click', async () => {
            if (!(await confirmAction('Delete this document?', doc.title, 'Delete'))) return;
            await busy(remove, status, async () => { await api('DELETE', `/api/admin/documents/${encodeURIComponent(doc.id)}`); reload(); });
          });
          return h('li', {}, h('a', { href: doc.url, target: '_blank', rel: 'noopener', text: doc.title }), ` · ${doc.kind.replace('_', ' ')} · ${Math.round(doc.size / 1024)} KB `, remove);
        });
        return h('section', { class: 'card' }, h('h2', { text: 'Documents' }), rows.length ? h('ul', {}, rows) : h('p', { class: 'muted', text: 'No documents yet.' }),
          h('div', { class: 'row' }, field('Kind', kind), field('Title', title), field('File (PDF, PNG, JPEG, 10 MB)', file), upload), status);
      }
    },
  });
})();
