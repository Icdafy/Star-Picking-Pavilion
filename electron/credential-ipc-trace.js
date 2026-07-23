'use strict';

const CREDENTIAL_IPC_STAGES = Object.freeze([
  'received',
  'stored',
  'failed',
  'ack-posted',
  'settings-request-received',
  'settings-body-read',
  'settings-coordinator-enter',
  'settings-patch-applied',
  'credential-change-yes',
  'credential-change-no',
  'settings-save-start',
  'settings-save-complete',
  'credential-persist-start',
  'credential-posted',
  'credential-ack-received',
  'credential-timeout'
]);
const ALLOWED_STAGES = new Set(CREDENTIAL_IPC_STAGES);

function createCredentialIpcTracer({
  enabled = false,
  log = console.log
} = {}) {
  if (typeof log !== 'function') throw new TypeError('log must be a function');
  return stage => {
    if (!enabled || !ALLOWED_STAGES.has(stage)) return;
    log(`[credential-ipc] ${stage}`);
  };
}

module.exports = { CREDENTIAL_IPC_STAGES, createCredentialIpcTracer };
