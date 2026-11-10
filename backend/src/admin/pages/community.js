/*
 * Community (building management): publish notices and alerts, events (with places and who is coming), polls,
 * and answer residents' feedback. Talks to /api/admin/community/*. Times typed here are in this computer's time
 * zone. Text is only ever set with textContent.
 */
'use strict';

(() => {
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const isoOf = (local) => (local ? new Date(local).toISOString() : null);
  const TOPIC = { suggestion: 'Suggestion', concern: 'Concern', compliment: 'Compliment', other: 'Other' };

  window.ParklaneAdmin.register({
    id: 'community',
    label: 'Community',
    roles: ['admin'],
    async render(content, ui) {
      const { h, api, notice, busy, field } = ui;
      const pictures = await api('GET', '/api/admin/pictures');
      const pictureSelect = () => h('select', { 'aria-label': 'Picture' }, h('option', { value: '', text: 'No picture' }), pictures.map((p) => h('option', { value: p, text: p })));
      const noticesSlot = h('div');
      const eventsSlot = h('div');
      const pollsSlot = h('div');
      const feedbackSlot = h('div');
      const table = (heads, rows) => h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((t) => h('th', { text: t })))), h('tbody', {}, rows)));
      const action = (label, status, work, cls = 'small') => {
        const button = h('button', { class: `btn ${cls}`, text: label });
        button.addEventListener('click', () => busy(button, status, work));
        return button;
      };

      async function draw() {
        const data = await api('GET', '/api/admin/community');
        drawNotices(data.announcements);
        drawEvents(data.events);
        drawPolls(data.polls);
      }

      function drawNotices(list) {
        const status = h('div');
        const kind = h('select', { 'aria-label': 'Kind' }, h('option', { value: 'news', text: 'Announcement' }), h('option', { value: 'alert', text: 'Community alert' }));
        const level = h('select', { 'aria-label': 'Level' }, h('option', { value: 'info', text: 'Information' }), h('option', { value: 'warning', text: 'Warning' }));
        const title = h('input', { placeholder: 'e.g. Pool closed for maintenance' });
        const summary = h('input', { placeholder: 'One line residents see in the list' });
        const fullText = h('textarea', { rows: '3', placeholder: 'More detail, shown when opened (optional)' });
        const picture = pictureSelect();
        const expires = h('input', { type: 'datetime-local' });
        const publish = action('Publish', status, async () => {
          await api('POST', '/api/admin/community/announcements', { kind: kind.value, level: level.value, title: title.value, body: summary.value, fullText: fullText.value, picture: picture.value || null, expiresAt: isoOf(expires.value) });
          draw();
        }, 'primary');
        const now = Date.now();
        const rows = list.map((n) => {
          const live = !n.expiresAt || Date.parse(n.expiresAt) > now;
          return h('tr', {}, h('td', { text: n.kind === 'alert' ? `Alert (${n.level})` : 'Announcement' }), h('td', { text: n.title }), h('td', { text: when(n.publishedAt) }),
            h('td', {}, h('span', { class: `badge ${live ? 'ok' : ''}`, text: live ? (n.expiresAt ? `Until ${when(n.expiresAt)}` : 'Live') : 'Expired' })),
            h('td', {}, live ? action('Take down', status, async () => { await api('POST', `/api/admin/community/announcements/${encodeURIComponent(n.id)}/expire`); draw(); }) : null, ' ',
              action('Delete', status, async () => { await api('DELETE', `/api/admin/community/announcements/${encodeURIComponent(n.id)}`); draw(); })));
        });
        noticesSlot.replaceChildren(
          h('p', { class: 'muted', text: 'Residents are told in their inbox when you publish.' }),
          h('div', { class: 'row' }, field('Kind', kind), field('Level', level), field('Picture', picture), field('Take down on (optional)', expires)),
          h('div', { class: 'row' }, field('Title', title), field('Summary', summary)), field('Details', fullText), publish, status,
          list.length ? table(['Kind', 'Title', 'Published', 'Status', ''], rows) : h('p', { class: 'muted', text: 'Nothing published yet.' }),
        );
      }

      function drawEvents(list) {
        const status = h('div');
        const title = h('input', { placeholder: 'e.g. Family movie night' });
        const description = h('textarea', { rows: '2', placeholder: 'What residents should know' });
        const venue = h('input', { placeholder: 'e.g. Clubhouse lounge' });
        const starts = h('input', { type: 'datetime-local' });
        const ends = h('input', { type: 'datetime-local' });
        const capacity = h('input', { type: 'number', min: '1', placeholder: 'No limit' });
        const opens = h('input', { type: 'datetime-local' });
        const until = h('input', { type: 'datetime-local' });
        const picture = pictureSelect();
        const create = action('Add event', status, async () => {
          await api('POST', '/api/admin/community/events', {
            title: title.value, description: description.value, venue: venue.value, startsAt: isoOf(starts.value), endsAt: isoOf(ends.value),
            capacity: capacity.value ? Number(capacity.value) : null, rsvpOpensAt: isoOf(opens.value), rsvpUntil: isoOf(until.value), picture: picture.value || null,
          });
          draw();
        }, 'primary');
        const detail = h('div');
        const rows = list.map((e) => {
          const note = h('input', { placeholder: 'Reason (sent to those registered)', 'aria-label': `Reason for cancelling ${e.title}` });
          return h('tr', {}, h('td', { text: e.title }), h('td', { text: `${when(e.startsAt)} · ${e.venue}` }),
            h('td', { text: e.capacity ? `${e.going} / ${e.capacity}` : String(e.going) }),
            h('td', {}, h('span', { class: `badge ${e.cancelled ? 'bad' : 'ok'}`, text: e.cancelled ? 'Cancelled' : e.rsvp })),
            h('td', {},
              action('Who is coming', status, async () => {
                const people = await api('GET', `/api/admin/community/events/${encodeURIComponent(e.id)}/attendees`);
                detail.replaceChildren(h('h3', { text: `${e.title}: ${people.length} registered` }), h('ul', {}, people.map((p) => h('li', { text: `${p.name}${p.unitName ? ` · ${p.unitName}` : ''}` }))));
              }), ' ',
              e.cancelled ? null : note, e.cancelled ? null : action('Cancel event', status, async () => { await api('POST', `/api/admin/community/events/${encodeURIComponent(e.id)}/cancel`, { note: note.value }); draw(); }, 'small danger')));
        });
        eventsSlot.replaceChildren(
          h('div', { class: 'row' }, field('Title', title), field('Venue', venue), field('Picture', picture)), field('Description', description),
          h('div', { class: 'row' }, field('Starts', starts), field('Ends', ends), field('Places', capacity)),
          h('div', { class: 'row' }, field('Registration opens (optional)', opens), field('Registration closes (optional)', until)), create, status,
          list.length ? table(['Event', 'When and where', 'Coming', 'State', ''], rows) : h('p', { class: 'muted', text: 'No events in the last 30 days or ahead.' }), detail,
        );
      }

      function drawPolls(list) {
        const status = h('div');
        const question = h('input', { placeholder: 'e.g. Which activity should we add first?' });
        const options = h('textarea', { rows: '4', placeholder: 'One option per line (2 to 6). Add a picture with "|", e.g. More events|events' });
        const closes = h('input', { type: 'datetime-local' });
        const create = action('Open poll', status, async () => {
          const parsed = options.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const [label, picture] = line.split('|').map((p) => p.trim()); return { label, picture: picture || null }; });
          await api('POST', '/api/admin/community/polls', { question: question.value, closesAt: isoOf(closes.value), options: parsed });
          draw();
        }, 'primary');
        const rows = list.map((p) => h('tr', {}, h('td', { text: p.question }),
          h('td', { text: p.options.map((o) => `${o.label}: ${o.votes}`).join(' · ') }), h('td', { text: String(p.totalVotes) }),
          h('td', {}, h('span', { class: `badge ${p.open ? 'ok' : ''}`, text: p.open ? `Open until ${when(p.closesAt)}` : `Closed ${when(p.closesAt)}` })),
          h('td', {}, p.open ? action('Close now', status, async () => { await api('POST', `/api/admin/community/polls/${encodeURIComponent(p.id)}/close`); draw(); }) : null, ' ',
            action('Delete', status, async () => { await api('DELETE', `/api/admin/community/polls/${encodeURIComponent(p.id)}`); draw(); }))));
        pollsSlot.replaceChildren(
          h('p', { class: 'muted', text: `Each resident has one vote and can change it until the poll closes. Pictures: ${pictures.join(', ')}.` }),
          h('div', { class: 'row' }, field('Question', question), field('Closes', closes)), field('Options', options), create, status,
          list.length ? table(['Question', 'Votes per option', 'Total', 'State', ''], rows) : h('p', { class: 'muted', text: 'No polls yet.' }),
        );
      }

      async function drawFeedback(filter = 'new') {
        const status = h('div');
        const pick = h('select', { 'aria-label': 'Show' }, [['new', 'New'], ['answered', 'Answered'], ['closed', 'Closed'], ['', 'All']].map(([value, text]) => h('option', { value, text, selected: value === filter })));
        pick.addEventListener('change', () => drawFeedback(pick.value));
        const list = await api('GET', `/api/admin/community/feedback${filter ? `?status=${filter}` : ''}`);
        const rows = list.map((f) => {
          const reply = h('input', { placeholder: 'Reply (goes to the resident\'s inbox)', value: f.reply || '', 'aria-label': `Reply to ${f.fromName || 'resident'}` });
          return h('tr', {}, h('td', { text: when(f.createdAt) }), h('td', { text: `${f.fromName || 'Former resident'}${f.unitName ? ` · ${f.unitName}` : ''}` }),
            h('td', { text: TOPIC[f.topic] }), h('td', { text: f.message }),
            h('td', {}, f.status === 'closed' ? h('span', { class: 'badge', text: 'Closed' }) : [reply, ' ',
              action('Send', status, async () => { await api('POST', `/api/admin/community/feedback/${encodeURIComponent(f.id)}/reply`, { reply: reply.value }); drawFeedback(filter); }), ' ',
              action('Close', status, async () => { await api('POST', `/api/admin/community/feedback/${encodeURIComponent(f.id)}/close`); drawFeedback(filter); })]));
        });
        feedbackSlot.replaceChildren(h('div', { class: 'row' }, field('Show', pick)), status,
          list.length ? table(['Sent', 'From', 'Topic', 'Message', 'Reply'], rows) : h('p', { class: 'muted', text: 'No messages here.' }));
      }

      content.replaceChildren(
        h('section', { class: 'card' }, h('h2', { text: 'Notices and alerts' }), noticesSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Events' }), eventsSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Polls' }), pollsSlot),
        h('section', { class: 'card' }, h('h2', { text: 'Resident feedback' }), feedbackSlot),
      );
      await Promise.all([draw(), drawFeedback()]);
      if (!pictures.length) content.prepend(notice('error', 'The picture list could not be loaded.'));
    },
  });
})();
