'use strict';

function collectionIntervalMs(value) {
  const minutes = Number(value);
  const normalized = Number.isInteger(minutes) && minutes >= 10 && minutes <= 720 ? minutes : 10;
  return normalized * 60 * 1000;
}

module.exports = { collectionIntervalMs };
