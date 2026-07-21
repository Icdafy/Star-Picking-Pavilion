'use strict';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfLocalDayIso(date = new Date()) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  ).toISOString();
}

function localDateTimeToIso(dateString, hour) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

module.exports = { localDateString, localDateTimeToIso, startOfLocalDayIso };
