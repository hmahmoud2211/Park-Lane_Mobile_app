/*
 * Reported AI answers (building management): what people flagged from the Parklane Assistant (chat and voice) and
 * Health Passport (spoken summaries, documents the AI read), with their reason and note; mark each one reviewed.
 * Talks to /api/admin/ai-reports. The answers can hold health information: they are shown here only, and text is
 * only ever set with textContent.
 */
'use strict';

(() => {
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const SOURCE = { assistant: 'Assistant chat', assistant_voice: 'Assistant voice', health_summary: 'Health summary', health_review: 'Document reading' };
  const REASON = { offensive: 'Offensive or hurtful', harmful: 'Could cause harm', wrong: 'Wrong information', other: 'Something else' };
  const PREVIEW = 140;

  window.ParklaneAdmin.register({
    id: 'ai-reports',
    label: 'AI reports',
    roles: ['admin'],
    async render(content, ui) {
      const { h, api, busy, field } = ui;
      const slot = h('div');

      /** The first words, and the whole answer one click away. */
      const longText = (text) => {
        if (text.length <= PREVIEW) return h('div', { class: 'report-text', text });
        return h('details', {}, h('summary', { text: `${text.slice(0, PREVIEW).trimEnd()}…` }), h('div', { class: 'report-text', text }));
      };

      async function draw(filter = 'new') {
        const status = h('div');
        const pick = h('select', { 'aria-label': 'Show' }, [['new', 'New'], ['reviewed', 'Reviewed'], ['', 'All']].map(([value, text]) => h('option', { value, text, selected: value === filter })));
        pick.addEventListener('change', () => draw(pick.value));
        const list = await api('GET', `/api/admin/ai-reports${filter ? `?status=${filter}` : ''}`);
        const rows = list.map((report) => {
          const from = report.signedIn ? `${report.fromName || 'Resident'}${report.unitName ? ` · ${report.unitName}` : ''}` : 'Guest';
          const mark = h('button', { class: 'btn small', text: 'Mark reviewed' });
          mark.addEventListener('click', () => busy(mark, status, async () => {
            await api('POST', `/api/admin/ai-reports/${encodeURIComponent(report.id)}/reviewed`);
            draw(filter);
          }));
          return h('tr', {},
            h('td', { text: when(report.createdAt) }),
            h('td', { text: SOURCE[report.source] || report.source }),
            h('td', { text: REASON[report.reason] || report.reason }),
            h('td', { text: from }),
            h('td', { class: 'report-cell' }, report.note ? longText(report.note) : h('span', { class: 'muted', text: '—' })),
            h('td', { class: 'report-cell' }, longText(report.excerpt)),
            h('td', {}, report.status === 'reviewed' ? h('span', { class: 'badge ok', text: `Reviewed ${when(report.reviewedAt)}` }) : mark));
        });
        slot.replaceChildren(
          h('p', { class: 'muted', text: 'People report AI answers from the app, signed in or as guests. Read each one, act on it, then mark it reviewed.' }),
          h('div', { class: 'row' }, field('Show', pick)), status,
          list.length
            ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Sent', 'Where', 'Reason', 'From', 'Note', 'AI answer', ''].map((t) => h('th', { text: t })))), h('tbody', {}, rows)))
            : h('p', { class: 'muted', text: 'No reports here.' }),
        );
      }

      content.replaceChildren(h('section', { class: 'card' }, h('h2', { text: 'Reported AI answers' }), slot));
      await draw();
    },
  });
})();
