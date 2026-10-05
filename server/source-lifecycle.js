'use strict';

const { db, now } = require('./db');

function removeSource(sourceId, database = db) {
  return database.prepare(`UPDATE sources SET enabled=0, removed_at=?,
    consecutive_errors=0, next_fetch_at=NULL WHERE id=? AND removed_at IS NULL`)
    .run(now(), sourceId).changes;
}

function removeDisabledSources(database = db) {
  return database.prepare(`UPDATE sources SET removed_at=?, consecutive_errors=0,
    next_fetch_at=NULL WHERE enabled=0 AND removed_at IS NULL`).run(now()).changes;
}

module.exports = { removeSource, removeDisabledSources };
