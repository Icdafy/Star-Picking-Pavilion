'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function summarizeSourceResults(results) {
  const ok = [];
  const empty = [];
  const failed = [];

  for (const result of results) {
    if (result.error) {
      failed.push({ source: result.source, error: result.error });
    } else if (Number(result.fetched) === 0) {
      empty.push({ source: result.source, fetched: 0 });
    } else {
      ok.push({
        source: result.source,
        fetched: result.fetched,
        added: result.added,
        ms: result.ms
      });
    }
  }

  return {
    auditedAt: new Date().toISOString(),
    counts: {
      total: results.length,
      ok: ok.length,
      empty: empty.length,
      failed: failed.length
    },
    ok,
    empty,
    failed
  };
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runAudit(options = {}) {
  const priorDataDir = process.env.STAR_PICKING_PAVILION_DATA_DIR;
  const temporary = !priorDataDir;
  const dataDir = priorDataDir
    || await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spp-source-audit-'));
  process.env.STAR_PICKING_PAVILION_DATA_DIR = dataDir;

  const { collectAll } = require('../server/collectors');
  const { closeDatabase } = require('../server/db');
  try {
    const collection = await collectAll(undefined, { force: true });
    const summary = summarizeSourceResults(collection.results);
    const output = options.output ? path.resolve(options.output) : null;
    if (output) {
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      await fs.promises.writeFile(output, JSON.stringify(summary, null, 2), 'utf8');
    }
    return summary;
  } finally {
    closeDatabase();
    if (temporary) {
      delete process.env.STAR_PICKING_PAVILION_DATA_DIR;
      await fs.promises.rm(dataDir, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  runAudit({ output: argumentValue(process.argv.slice(2), '--output') })
    .then(summary => {
      console.log(JSON.stringify(summary, null, 2));
      if (process.argv.includes('--strict') && summary.counts.failed > 0) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runAudit, summarizeSourceResults };
