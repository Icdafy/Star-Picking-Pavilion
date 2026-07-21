'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  localDateString,
  localDateTimeToIso,
  startOfLocalDayIso
} = require('../server/date-time');

test('local calendar helpers do not derive dates from UTC string slicing', () => {
  const oneAm = new Date(2026, 6, 21, 1, 0, 0);
  assert.equal(localDateString(oneAm), '2026-07-21');
  assert.equal(startOfLocalDayIso(oneAm), new Date(2026, 6, 21, 0, 0, 0).toISOString());
  assert.equal(localDateTimeToIso('2026-07-21', 8), new Date(2026, 6, 21, 8, 0, 0).toISOString());
});
