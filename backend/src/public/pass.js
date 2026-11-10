/*
 * The visitor's parking pass: shows the one booking this link opens, its QR while it can open a gate, where to
 * park, and lets the visitor add their plate or ask security for help. The link's token is the key, so the page
 * sends no referrer and is never cached. Text is only ever set with textContent.
 */
'use strict';

(() => {
  const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const main = document.getElementById('pass');
  const api = `/api/parking/pass/${encodeURIComponent(token)}`;
  const SVG = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child) node.append(child);
    return node;
  }

  function qrSvg(qr) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${qr.size} ${qr.size}`);
    svg.setAttribute('class', 'qr');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Parking pass QR code: show it at the gate');
    svg.setAttribute('shape-rendering', 'crispEdges');
    const background = document.createElementNS(SVG, 'rect');
    background.setAttribute('width', String(qr.size));
    background.setAttribute('height', String(qr.size));
    background.setAttribute('fill', '#ffffff');
    const modules = document.createElementNS(SVG, 'path');
    modules.setAttribute('d', qr.path);
    modules.setAttribute('fill', '#000000');
    svg.append(background, modules);
    return svg;
  }

  async function call(method, path, body) {
    const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, referrerPolicy: 'no-referrer', cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.ok) throw new Error((json.error && json.error.message) || 'Something went wrong. Please try again.');
    return json.data;
  }

  function render(pass) {
    const status = el('p', {}, el('span', { class: 'status', text: pass.status.label }), pass.reference ? ` · ${pass.reference}` : '');
    const facts = el('dl', { class: 'facts' },
      el('dt', { text: 'When' }), el('dd', { text: pass.when }),
      el('dt', { text: 'Bay' }), el('dd', { text: `${pass.bay.label} · ${pass.bay.zone} (${pass.bay.level})` }),
      el('dt', { text: 'Gate' }), el('dd', { text: `${pass.gate.name}${pass.gate.description ? ` · ${pass.gate.description}` : ''}` }),
      el('dt', { text: 'Plate' }), el('dd', { text: pass.plate || 'Not added yet' }),
    );
    const message = el('p', { class: 'done' });
    const plateForm = pass.plate ? null : el('form', { onsubmit: async (event) => {
      event.preventDefault();
      const input = event.target.querySelector('input');
      message.textContent = '';
      try { render(await call('POST', `${api}/plate`, { plate: input.value })); } catch (error) { message.textContent = error.message; }
    } },
      el('label', { for: 'plate', text: 'Your car\'s plate (needed to enter)' }),
      el('input', { id: 'plate', name: 'plate', autocomplete: 'off', maxlength: '12', required: true }),
      el('button', { type: 'submit', text: 'Save plate' }));
    const help = (kind, label, cls) => el('button', { type: 'button', class: cls, text: label, onclick: async () => {
      message.textContent = '';
      try { await call('POST', `${api}/help`, { kind }); message.textContent = 'Security has been told. Someone will help you shortly.'; } catch (error) { message.textContent = error.message; }
    } });
    main.replaceChildren(
      el('h1', { text: pass.guestName ? `Parking for ${pass.guestName}` : 'Your parking pass' }),
      el('p', { class: 'meta', text: pass.compound }),
      status,
      pass.qr ? qrSvg(pass.qr) : el('p', { class: 'notice', text: 'This pass can\'t open the gate right now.' }),
      pass.qr ? el('p', { class: 'meta', text: 'Show this code at the gate. Don\'t share it with anyone else.' }) : null,
      facts,
      pass.directions.length ? el('h2', { text: 'Directions' }) : null,
      pass.directions.length ? el('ol', {}, pass.directions.map((step) => el('li', { text: step }))) : null,
      plateForm,
      el('h2', { text: 'Need help?' }),
      el('div', { class: 'actions' }, help('space-occupied', 'My bay is taken'), help('contact', 'Ask security to contact me', 'secondary')),
      pass.securityPhone ? el('p', {}, 'Security desk: ', el('a', { href: `tel:${pass.securityPhone.replace(/[^\d+]/g, '')}`, text: pass.securityPhone })) : null,
      message,
    );
  }

  call('GET', api).then(render).catch((error) => {
    main.replaceChildren(el('h1', { text: 'Parking pass' }), el('p', { class: 'notice', text: error.message || 'This invitation is not available.' }));
  });
})();
