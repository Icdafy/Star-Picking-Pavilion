'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const ARCHIVE_DIRECTORY_NAME = '摘星阁新闻简报';
const MARKDOWN_FILE_NAME = '新闻简报.md';
const JSONL_FILE_NAME = 'news.jsonl';
const MANIFEST_FILE_NAME = 'manifest.json';
const STATE_FILE_NAME = 'daily-archive.json';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const DEFAULT_DAILY_ARCHIVE_STATE = Object.freeze({
  schemaVersion: 1,
  enabled: false,
  rootDirectory: '',
  enabledAt: null,
  lastSuccessfulDate: null,
  lastIntegrityCheckDate: null,
  lastAttemptAt: null,
  lastErrorCode: null,
  lastErrorAt: null
});

class DailyArchiveError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DailyArchiveError';
    this.code = code;
  }
}

function cloneState(state = DEFAULT_DAILY_ARCHIVE_STATE) {
  return { ...state };
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertValidDate(value, label = 'date') {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date`);
  }
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDate(value) {
  assertValidDate(value);
  return [
    String(value.getFullYear()).padStart(4, '0'),
    pad(value.getMonth() + 1),
    pad(value.getDate())
  ].join('-');
}

function parseLocalDate(value, hour = 0) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = new Date(year, month - 1, day, hour, 0, 0, 0);
  if (
    result.getFullYear() !== year
    || result.getMonth() !== month - 1
    || result.getDate() !== day
    || result.getHours() !== hour
  ) {
    return null;
  }
  return result;
}

function addLocalDays(date, days) {
  const parsed = parseLocalDate(date);
  if (!parsed) throw new TypeError('date must be a real YYYY-MM-DD local date');
  parsed.setDate(parsed.getDate() + days);
  return formatLocalDate(parsed);
}

function mostRecentDueDate(now) {
  assertValidDate(now, 'now');
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    8,
    0,
    0,
    0
  );
  if (now < cutoff) cutoff.setDate(cutoff.getDate() - 1);
  return formatLocalDate(cutoff);
}

function nextRunAt(now) {
  assertValidDate(now, 'now');
  const result = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    8,
    0,
    0,
    0
  );
  if (now >= result) result.setDate(result.getDate() + 1);
  return result;
}

function firstDueDateForEnabledAt(enabledAt) {
  const enabled = new Date(enabledAt);
  if (Number.isNaN(enabled.getTime())) return null;
  const cutoff = new Date(
    enabled.getFullYear(),
    enabled.getMonth(),
    enabled.getDate(),
    8,
    0,
    0,
    0
  );
  if (enabled > cutoff) cutoff.setDate(cutoff.getDate() + 1);
  return formatLocalDate(cutoff);
}

function enumerateDueDates(state, now) {
  assertValidDate(now, 'now');
  if (!isPlainObject(state) || state.enabled !== true || typeof state.enabledAt !== 'string') {
    return [];
  }

  const firstEnabledDate = firstDueDateForEnabledAt(state.enabledAt);
  if (!firstEnabledDate) return [];
  let firstDate = firstEnabledDate;
  if (typeof state.lastSuccessfulDate === 'string' && parseLocalDate(state.lastSuccessfulDate)) {
    const afterSuccess = addLocalDays(state.lastSuccessfulDate, 1);
    if (afterSuccess > firstDate) firstDate = afterSuccess;
  }

  const lastDate = mostRecentDueDate(now);
  if (firstDate > lastDate) return [];

  const dates = [];
  for (let date = firstDate; date <= lastDate; date = addLocalDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function normalizeStoredState(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion !== 1) return cloneState();
  if (typeof raw.enabled !== 'boolean') return cloneState();
  if (typeof raw.rootDirectory !== 'string') return cloneState();
  if (raw.rootDirectory && !path.isAbsolute(raw.rootDirectory)) return cloneState();
  if (raw.enabledAt !== null && !isIsoTimestamp(raw.enabledAt)) return cloneState();
  if (raw.lastSuccessfulDate !== null && !parseLocalDate(raw.lastSuccessfulDate)) {
    return cloneState();
  }
  const lastIntegrityCheckDate = raw.lastIntegrityCheckDate == null
    ? null
    : raw.lastIntegrityCheckDate;
  if (lastIntegrityCheckDate !== null && !parseLocalDate(lastIntegrityCheckDate)) {
    return cloneState();
  }
  if (raw.lastAttemptAt !== null && !isIsoTimestamp(raw.lastAttemptAt)) return cloneState();
  if (raw.lastErrorCode !== null && typeof raw.lastErrorCode !== 'string') return cloneState();
  if (raw.lastErrorAt !== null && !isIsoTimestamp(raw.lastErrorAt)) return cloneState();
  if (raw.enabled && (!raw.rootDirectory || !raw.enabledAt)) return cloneState();

  return {
    schemaVersion: 1,
    enabled: raw.enabled,
    rootDirectory: raw.rootDirectory,
    enabledAt: raw.enabledAt,
    lastSuccessfulDate: raw.lastSuccessfulDate,
    lastIntegrityCheckDate,
    lastAttemptAt: raw.lastAttemptAt,
    lastErrorCode: raw.lastErrorCode,
    lastErrorAt: raw.lastErrorAt
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isInside(rootDirectory, candidate) {
  const relative = path.relative(rootDirectory, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeArchiveError(error, fallbackCode = 'archive-write-failed') {
  if (error instanceof DailyArchiveError) return error;
  return new DailyArchiveError(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error : undefined
  );
}

function createDailyArchiveService({
  userDataPath,
  requestBundle,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  getTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  monotonicNow = () => performance.now(),
  fileSystem = fs.promises,
  randomBytes = crypto.randomBytes
} = {}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('userDataPath must be an absolute path');
  }
  if (typeof requestBundle !== 'function') throw new TypeError('requestBundle must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof setTimer !== 'function') throw new TypeError('setTimer must be a function');
  if (typeof clearTimer !== 'function') throw new TypeError('clearTimer must be a function');
  if (typeof getTimeZone !== 'function') throw new TypeError('getTimeZone must be a function');
  if (typeof monotonicNow !== 'function') throw new TypeError('monotonicNow must be a function');
  if (!fileSystem || typeof fileSystem !== 'object') {
    throw new TypeError('fileSystem must provide promise-based filesystem methods');
  }
  if (typeof randomBytes !== 'function') throw new TypeError('randomBytes must be a function');

  const statePath = path.join(userDataPath, STATE_FILE_NAME);
  let state = cloneState();
  let loaded = false;
  let started = false;
  let timer = null;
  let scheduledAt = null;
  let scheduledWallClockMs = null;
  let scheduledMonotonicMs = null;
  let scheduledTimeZone = null;
  let scheduledOffsetMinutes = null;
  let scheduleRefreshInFlight = null;
  let runningDate = null;
  let lastResult = null;
  let writeQueue = Promise.resolve();
  let archiveQueue = Promise.resolve();
  const inFlightByDate = new Map();

  function clock() {
    const value = now();
    assertValidDate(value, 'now');
    return new Date(value.getTime());
  }

  function monotonicClock() {
    const value = Number(monotonicNow());
    if (!Number.isFinite(value)) throw new TypeError('monotonicNow must return a finite number');
    return value;
  }

  function randomToken() {
    return randomBytes(6).toString('hex');
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    let serialized;
    try {
      serialized = await fileSystem.readFile(statePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    try {
      state = normalizeStoredState(JSON.parse(serialized));
    } catch {
      state = cloneState();
    }
  }

  function writeStateSnapshot(snapshot) {
    const operation = writeQueue
      .catch(() => {})
      .then(async () => {
        await fileSystem.mkdir(userDataPath, { recursive: true });
        const temporary = path.join(
          userDataPath,
          `.daily-archive.${process.pid}-${randomToken()}.tmp`
        );
        try {
          await fileSystem.writeFile(
            temporary,
            `${JSON.stringify(snapshot, null, 2)}\n`,
            { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true }
          );
          await fileSystem.rename(temporary, statePath);
        } catch (error) {
          await fileSystem.rm(temporary, { force: true }).catch(() => {});
          throw error;
        }
      });
    writeQueue = operation;
    return operation;
  }

  function persist() {
    return writeStateSnapshot(cloneState(state));
  }

  async function persistStateChange(nextState, { resetLastResult = false } = {}) {
    const previousState = state;
    const previousLastResult = lastResult;
    state = nextState;
    if (resetLastResult) lastResult = null;
    try {
      await persist();
    } catch (error) {
      state = previousState;
      lastResult = previousLastResult;
      throw error;
    }
  }

  async function validateRoot(rootDirectory) {
    if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) {
      throw new DailyArchiveError('directory-invalid', '归档目录必须是绝对路径。');
    }

    let probe = null;
    let handle = null;
    try {
      const selectedStats = await fileSystem.lstat(rootDirectory);
      if (selectedStats.isSymbolicLink() || !selectedStats.isDirectory()) {
        throw new DailyArchiveError('directory-invalid', '归档位置必须是普通文件夹。');
      }
      const physicalRoot = await fileSystem.realpath(rootDirectory);
      const physicalStats = await fileSystem.lstat(physicalRoot);
      if (physicalStats.isSymbolicLink() || !physicalStats.isDirectory()) {
        throw new DailyArchiveError('directory-invalid', '归档位置必须是普通文件夹。');
      }

      probe = path.join(physicalRoot, `.spp-write-probe-${process.pid}-${randomToken()}.tmp`);
      handle = await fileSystem.open(probe, 'wx', 0o600);
      await handle.writeFile('ok', 'utf8');
      await handle.close();
      handle = null;
      await fileSystem.rm(probe, { force: true });
      probe = null;
      return physicalRoot;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (probe) await fileSystem.rm(probe, { force: true }).catch(() => {});
      if (error instanceof DailyArchiveError) throw error;
      throw new DailyArchiveError(
        'directory-unavailable',
        '归档目录当前不可用或不可写，请检查磁盘后重试。',
        error
      );
    }
  }

  async function ensureSafeDirectory(parent, segment, physicalRoot) {
    const candidate = path.join(parent, segment);
    if (!isInside(physicalRoot, candidate)) {
      throw new DailyArchiveError('directory-invalid', '归档路径超出所选目录。');
    }
    try {
      await fileSystem.mkdir(candidate);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const stats = await fileSystem.lstat(candidate);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new DailyArchiveError('directory-invalid', '归档子目录不能是链接或普通文件。');
    }
    const resolved = await fileSystem.realpath(candidate);
    if (!isInside(physicalRoot, resolved)) {
      throw new DailyArchiveError('directory-invalid', '归档子目录超出所选目录。');
    }
    return candidate;
  }

  async function ensureArchiveMonth(rootDirectory, date) {
    const match = DATE_PATTERN.exec(date);
    if (!match || !parseLocalDate(date)) {
      throw new TypeError('date must be a real YYYY-MM-DD local date');
    }
    const physicalRoot = await validateRoot(rootDirectory);
    let current = await ensureSafeDirectory(
      physicalRoot,
      ARCHIVE_DIRECTORY_NAME,
      physicalRoot
    );
    current = await ensureSafeDirectory(current, match[1], physicalRoot);
    return ensureSafeDirectory(current, match[2], physicalRoot);
  }

  async function pathExists(candidate) {
    try {
      await fileSystem.lstat(candidate);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function readRegularFile(directory, fileName) {
    const file = path.join(directory, fileName);
    const stats = await fileSystem.lstat(file);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`${fileName} is not a regular file`);
    }
    return fileSystem.readFile(file);
  }

  async function verifyExistingArchive(directory, date) {
    try {
      const stats = await fileSystem.lstat(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return false;
      const manifestBuffer = await readRegularFile(directory, MANIFEST_FILE_NAME);
      const manifest = JSON.parse(manifestBuffer.toString('utf8'));
      if (
        !isPlainObject(manifest)
        || manifest.archiveSchemaVersion !== 1
        || manifest.date !== date
        || !isPlainObject(manifest.files)
      ) {
        return false;
      }

      for (const fileName of [MARKDOWN_FILE_NAME, JSONL_FILE_NAME]) {
        const expected = manifest.files[fileName];
        if (
          !isPlainObject(expected)
          || typeof expected.sha256 !== 'string'
          || !Number.isInteger(expected.bytes)
        ) {
          return false;
        }
        const contents = await readRegularFile(directory, fileName);
        if (contents.length !== expected.bytes || sha256(contents) !== expected.sha256) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async function chooseConflictDirectory(monthDirectory, date) {
    const timestamp = clock();
    const time = `${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}${pad(timestamp.getSeconds())}`;
    const base = `${date}-补存-${time}`;
    for (let index = 0; index < 10_000; index += 1) {
      const name = index === 0 ? base : `${base}-${index}`;
      const candidate = path.join(monthDirectory, name);
      if (!(await pathExists(candidate))) return candidate;
    }
    throw new DailyArchiveError('archive-conflict', '无法创建唯一的补存目录。');
  }

  async function findVerifiedArchive(monthDirectory, date) {
    const preferred = path.join(monthDirectory, date);
    if (await pathExists(preferred) && await verifyExistingArchive(preferred, date)) {
      return preferred;
    }
    const pattern = new RegExp(`^${date}-补存-\\d{6}(?:-\\d+)?$`);
    const names = await fileSystem.readdir(monthDirectory);
    for (const name of names.filter(candidate => pattern.test(candidate)).sort()) {
      const candidate = path.join(monthDirectory, name);
      if (await verifyExistingArchive(candidate, date)) return candidate;
    }
    return null;
  }

  function validateBundle(bundle, date) {
    if (
      !isPlainObject(bundle)
      || bundle.date !== date
      || typeof bundle.markdown !== 'string'
      || typeof bundle.jsonl !== 'string'
      || !isPlainObject(bundle.manifest)
    ) {
      throw new DailyArchiveError('bundle-invalid', '服务端返回的新闻简报数据不完整。');
    }
    return bundle;
  }

  async function requestValidatedBundle(date) {
    try {
      return validateBundle(await requestBundle(date), date);
    } catch (error) {
      if (error instanceof DailyArchiveError) throw error;
      throw new DailyArchiveError(
        'bundle-unavailable',
        error instanceof Error ? error.message : '新闻简报生成失败。',
        error instanceof Error ? error : undefined
      );
    }
  }

  async function writeArchive(directory, date, bundle) {
    const markdown = Buffer.from(bundle.markdown, 'utf8');
    const jsonl = Buffer.from(bundle.jsonl, 'utf8');
    const archivedAt = clock().toISOString();
    const manifest = {
      ...bundle.manifest,
      archiveSchemaVersion: 1,
      date,
      archivedAt,
      files: {
        [MARKDOWN_FILE_NAME]: {
          bytes: markdown.length,
          sha256: sha256(markdown)
        },
        [JSONL_FILE_NAME]: {
          bytes: jsonl.length,
          sha256: sha256(jsonl)
        }
      }
    };

    await fileSystem.writeFile(
      path.join(directory, MARKDOWN_FILE_NAME),
      markdown,
      { flag: 'wx', mode: 0o600, flush: true }
    );
    await fileSystem.writeFile(
      path.join(directory, JSONL_FILE_NAME),
      jsonl,
      { flag: 'wx', mode: 0o600, flush: true }
    );
    await fileSystem.writeFile(
      path.join(directory, MANIFEST_FILE_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true }
    );
  }

  function shouldAdvanceSuccess(date) {
    const pending = enumerateDueDates(state, clock());
    if (pending.length === 0) return true;
    return pending[0] === date;
  }

  async function markSuccess(date, result) {
    if (
      (!state.lastSuccessfulDate || date > state.lastSuccessfulDate)
      && shouldAdvanceSuccess(date)
    ) {
      state.lastSuccessfulDate = date;
    }
    state.lastErrorCode = null;
    state.lastErrorAt = null;
    lastResult = result;
    await persist();
  }

  async function recordFailure(error) {
    const normalized = normalizeArchiveError(error);
    state.lastErrorCode = normalized.code;
    state.lastErrorAt = clock().toISOString();
    lastResult = {
      status: 'error',
      date: runningDate,
      code: normalized.code,
      message: normalized.message
    };
    await persist().catch(() => {});
    return normalized;
  }

  async function performArchive(date) {
    state.lastAttemptAt = clock().toISOString();
    runningDate = date;
    await persist();

    let temporary = null;
    try {
      const physicalRoot = await validateRoot(state.rootDirectory);
      const monthDirectory = await ensureArchiveMonth(physicalRoot, date);
      const preferredDirectory = path.join(monthDirectory, date);
      const verifiedArchive = await findVerifiedArchive(monthDirectory, date);
      if (verifiedArchive) {
        const result = {
          status: 'existing',
          date,
          directory: verifiedArchive
        };
        await markSuccess(date, result);
        return result;
      }
      const preferredExists = await pathExists(preferredDirectory);

      const destination = preferredExists
        ? await chooseConflictDirectory(monthDirectory, date)
        : preferredDirectory;
      const bundle = await requestValidatedBundle(date);
      temporary = path.join(monthDirectory, `.${date}.partial-${process.pid}-${randomToken()}`);
      await fileSystem.mkdir(temporary);
      await writeArchive(temporary, date, bundle);
      await fileSystem.rename(temporary, destination);
      temporary = null;

      const result = {
        status: preferredExists ? 'saved-conflict' : 'saved',
        date,
        directory: destination
      };
      await markSuccess(date, result);
      return result;
    } catch (error) {
      if (temporary) {
        await fileSystem.rm(temporary, { recursive: true, force: true }).catch(() => {});
      }
      throw await recordFailure(error);
    } finally {
      runningDate = null;
    }
  }

  function archiveDate(date) {
    if (!parseLocalDate(date)) {
      return Promise.reject(new TypeError('date must be a real YYYY-MM-DD local date'));
    }
    const existing = inFlightByDate.get(date);
    if (existing) return existing;

    const operation = archiveQueue
      .catch(() => {})
      .then(() => performArchive(date));
    archiveQueue = operation.catch(() => {});
    inFlightByDate.set(date, operation);
    operation.finally(() => {
      if (inFlightByDate.get(date) === operation) inFlightByDate.delete(date);
    }).catch(() => {});
    return operation;
  }

  function clearSchedule() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    scheduledAt = null;
    scheduledWallClockMs = null;
    scheduledMonotonicMs = null;
    scheduledTimeZone = null;
    scheduledOffsetMinutes = null;
  }

  function scheduleNext() {
    clearSchedule();
    if (!started || !state.enabled) return;
    const current = clock();
    const target = nextRunAt(current);
    const delay = Math.max(0, target.getTime() - current.getTime());
    scheduledAt = target.toISOString();
    scheduledWallClockMs = current.getTime();
    scheduledMonotonicMs = monotonicClock();
    scheduledTimeZone = String(getTimeZone() || 'local');
    scheduledOffsetMinutes = current.getTimezoneOffset();
    timer = setTimer(async () => {
      timer = null;
      scheduledAt = null;
      try {
        await retry();
      } catch {
        // Failure is retained in state and retried on resume or the next cutoff.
      } finally {
        scheduleNext();
      }
    }, delay);
  }

  async function performScheduleRefresh() {
    if (!started || !state.enabled) return false;
    const current = clock();
    const target = nextRunAt(current);
    const timeZone = String(getTimeZone() || 'local');
    const offsetMinutes = current.getTimezoneOffset();
    const currentMonotonic = monotonicClock();
    const expectedWallClock = (
      Number.isFinite(scheduledWallClockMs)
      && Number.isFinite(scheduledMonotonicMs)
    )
      ? scheduledWallClockMs + Math.max(0, currentMonotonic - scheduledMonotonicMs)
      : null;
    const wallClockDrift = expectedWallClock == null
      ? Number.POSITIVE_INFINITY
      : Math.abs(current.getTime() - expectedWallClock);
    const unchanged = scheduledAt === target.toISOString()
      && scheduledTimeZone === timeZone
      && scheduledOffsetMinutes === offsetMinutes
      && wallClockDrift < 5_000;
    if (unchanged) return false;
    clearSchedule();
    try {
      await retry();
    } finally {
      scheduleNext();
    }
    return true;
  }

  function refreshSchedule() {
    if (scheduleRefreshInFlight) return scheduleRefreshInFlight;
    const operation = performScheduleRefresh();
    scheduleRefreshInFlight = operation;
    operation.finally(() => {
      if (scheduleRefreshInFlight === operation) scheduleRefreshInFlight = null;
    }).catch(() => {});
    return operation;
  }

  function getSnapshot() {
    let pendingDates = [];
    if (loaded && state.enabled) pendingDates = enumerateDueDates(state, clock());
    return {
      ...cloneState(state),
      runningDate,
      nextRunAt: scheduledAt,
      pendingDates,
      lastResult: lastResult ? { ...lastResult } : null
    };
  }

  async function start({ backgroundCatchUp = false } = {}) {
    await load();
    if (started) return getSnapshot();
    started = true;
    if (state.enabled) {
      scheduleNext();
      const catchUp = retry({ verifyHistorical: true });
      if (backgroundCatchUp) {
        catchUp.catch(() => {
          // Failure is retained in state and can be retried from the visible UI.
        });
      } else {
        try {
          await catchUp;
        } catch {
          // Startup remains available while the archive location is offline.
        }
      }
    }
    return getSnapshot();
  }

  function stop() {
    started = false;
    clearSchedule();
  }

  async function enable(rootDirectory) {
    await load();
    const physicalRoot = await validateRoot(rootDirectory);
    const sameRoot = state.enabled && state.rootDirectory === physicalRoot;
    const nextState = {
      ...state,
      enabled: true,
      rootDirectory: physicalRoot,
      enabledAt: sameRoot && state.enabledAt ? state.enabledAt : clock().toISOString(),
      lastSuccessfulDate: sameRoot ? state.lastSuccessfulDate : null,
      lastIntegrityCheckDate: sameRoot ? state.lastIntegrityCheckDate : null,
      lastAttemptAt: sameRoot ? state.lastAttemptAt : null,
      lastErrorCode: null,
      lastErrorAt: null
    };
    await persistStateChange(nextState, { resetLastResult: true });
    if (started) scheduleNext();
    return getSnapshot();
  }

  async function disable() {
    await load();
    await persistStateChange({
      ...state,
      enabled: false,
      lastErrorCode: null,
      lastErrorAt: null
    });
    clearSchedule();
    return getSnapshot();
  }

  async function saveCurrent() {
    await load();
    if (!state.rootDirectory) {
      throw new DailyArchiveError('directory-unconfigured', '请先选择新闻简报保存位置。');
    }
    return archiveDate(mostRecentDueDate(clock()));
  }

  function nextIntegrityAuditDate() {
    if (!state.lastSuccessfulDate) return null;
    const firstDate = firstDueDateForEnabledAt(state.enabledAt);
    if (!firstDate || firstDate > state.lastSuccessfulDate) return null;
    const cursor = state.lastIntegrityCheckDate;
    if (cursor && cursor >= firstDate && cursor < state.lastSuccessfulDate) {
      return addLocalDays(cursor, 1);
    }
    return firstDate;
  }

  async function retry({ verifyHistorical = false } = {}) {
    await load();
    if (!state.enabled) return [];
    const results = [];
    const dueDates = enumerateDueDates(state, clock());
    if (verifyHistorical) {
      const auditDate = nextIntegrityAuditDate();
      if (auditDate && !dueDates.includes(auditDate)) {
        results.push(await archiveDate(auditDate));
        state.lastIntegrityCheckDate = auditDate;
        await persist();
      }
    }
    for (const date of dueDates) {
      results.push(await archiveDate(date));
    }
    return results;
  }

  async function handleResume() {
    await load();
    clearSchedule();
    if (state.enabled) {
      try {
        await retry({ verifyHistorical: true });
      } catch {
        // Preserve the failure and keep the next scheduled retry.
      }
      scheduleNext();
    }
    return getSnapshot();
  }

  return Object.freeze({
    statePath,
    start,
    stop,
    getSnapshot,
    enable,
    disable,
    saveCurrent,
    retry,
    handleResume,
    refreshSchedule
  });
}

module.exports = {
  ARCHIVE_DIRECTORY_NAME,
  DEFAULT_DAILY_ARCHIVE_STATE,
  DailyArchiveError,
  MANIFEST_FILE_NAME,
  JSONL_FILE_NAME,
  MARKDOWN_FILE_NAME,
  createDailyArchiveService,
  enumerateDueDates,
  formatLocalDate,
  mostRecentDueDate,
  nextRunAt,
  normalizeStoredState
};
