import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { nestSections, toFlowStep } from '../src/ha/flows.ts';

/** Home Assistant config-flow results → the app's FlowStep. Pure, no network. */

const base = { flow_id: 'f1', handler: 'demo', step_id: 'user' };

describe('flow steps', () => {
  test('selects, numbers, booleans and constants, from both schema styles', () => {
    const step = toFlowStep(
      {
        ...base,
        type: 'form',
        data_schema: [
          { name: 'region', required: true, type: 'select', options: [['eu', 'Europe'], ['us', 'Americas']] },
          { name: 'country', required: true, selector: { select: { options: [{ value: 'sa', label: 'Saudi Arabia' }, 'eg'] } } },
          { name: 'interval', optional: true, default: 30, type: 'integer', valueMin: 10, valueMax: 300 },
          { name: 'pin', required: true, selector: { number: { min: 0, max: 9999, step: 1 } } },
          { name: 'remember', optional: true, selector: { boolean: {} } },
          { name: 'email', required: true, selector: { text: { type: 'email' } } },
          { name: 'note', type: 'constant', value: 'Read this first' },
        ],
      },
      {},
    );
    const byName = Object.fromEntries(step.fields.map((field) => [field.name, field]));
    assert.deepEqual(byName.region.options, [
      { value: 'eu', label: 'Europe' },
      { value: 'us', label: 'Americas' },
    ]);
    assert.deepEqual(byName.country.options, [
      { value: 'sa', label: 'Saudi Arabia' },
      { value: 'eg', label: 'Eg' },
    ]);
    assert.deepEqual([byName.interval.kind, byName.interval.min, byName.interval.max, byName.interval.default], ['number', 10, 300, 30]);
    assert.deepEqual([byName.pin.kind, byName.pin.max], ['number', 9999]);
    assert.equal(byName.remember.kind, 'boolean');
    assert.equal(byName.email.kind, 'email');
    assert.deepEqual([byName.note.kind, byName.note.data], ['constant', 'Read this first']);
    assert.equal(byName.region.label, 'Region', 'untranslated names are humanized');
  });

  test('fields in an expandable section keep it, and answers go back nested', () => {
    const step = toFlowStep(
      {
        ...base,
        type: 'form',
        data_schema: [
          { name: 'host', required: true, type: 'string' },
          { name: 'advanced', type: 'expandable', expanded: false, schema: [{ name: 'timeout', optional: true, type: 'integer' }] },
        ],
      },
      { 'component.demo.config.step.user.sections.advanced.data.timeout': 'Timeout (s)' },
    );
    assert.deepEqual(
      step.fields.map((field) => [field.name, field.section, field.label]),
      [
        ['host', null, 'Host'],
        ['timeout', 'advanced', 'Timeout (s)'],
      ],
    );
    assert.deepEqual(nestSections({ host: 'h', timeout: 5 }, step.fields), { host: 'h', advanced: { timeout: 5 } });
  });

  test('menus, aborts and progress use their translations', () => {
    const translations = {
      'component.demo.config.step.user.menu_options.cloud': 'Use the cloud',
      'component.demo.config.abort.already_configured': 'Already linked',
      'component.demo.config.progress.wait_for_device': 'Waiting for the device…',
    };
    const menu = toFlowStep({ ...base, type: 'menu', menu_options: ['cloud', 'local'] }, translations);
    assert.deepEqual(menu.menu, [
      { id: 'cloud', label: 'Use the cloud' },
      { id: 'local', label: 'Local' },
    ]);
    assert.equal(toFlowStep({ ...base, type: 'abort', reason: 'already_configured' }, translations).message, 'Already linked');
    assert.equal(toFlowStep({ ...base, type: 'progress', progress_action: 'wait_for_device' }, translations).message, 'Waiting for the device…');
  });
});
