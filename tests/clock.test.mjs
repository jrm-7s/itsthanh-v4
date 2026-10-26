// The footer clock's formatting, including the switch from PDT to PST on Nov 1, 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockParts } from '../src/core/clock.js';

const at = (iso) => clockParts(new Date(iso));

test('clock: HH-HH:MM is the Hanoi hour, the LA hour and the shared minutes, 24-hour', () => {
  assert.deepEqual(at('2026-10-26T07:22:00Z'), { time: '14-00:22', zone: 'PDT', hanoi: '14:22', la: '00:22' });
  assert.equal(at('2026-10-26T17:05:00Z').time, '00-10:05'); // midnight in Hanoi is 00, never 24
  assert.equal(at('2026-07-01T18:22:00Z').time, '01-11:22'); // the example in the spec: 01-11:22 PDT
});

test('clock: Los Angeles leaves daylight saving on Nov 1, 2026 (PDT → PST, gap 14 → 15 h)', () => {
  assert.deepEqual(at('2026-11-01T08:59:00Z'), { time: '15-01:59', zone: 'PDT', hanoi: '15:59', la: '01:59' });
  assert.deepEqual(at('2026-11-01T09:00:00Z'), { time: '16-01:00', zone: 'PST', hanoi: '16:00', la: '01:00' });
  assert.equal(at('2026-11-01T09:59:00Z').zone, 'PST'); // the repeated 1 AM hour is PST
  assert.equal(at('2026-12-15T20:30:00Z').time, '03-12:30');
  assert.equal(at('2027-03-14T10:00:00Z').zone, 'PDT'); // and back to PDT in March
});
