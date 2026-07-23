'use strict';

async function persistSettingsUpdate({
  currentSettings,
  update,
  persistCredential,
  saveSettings,
  trace = () => {}
}) {
  const saveSettingsWithTrace = async () => {
    trace('settings-save-start');
    await saveSettings(update.settings);
    trace('settings-save-complete');
  };

  if (!update?.credentialChanged) {
    await saveSettingsWithTrace();
    return;
  }

  const previousKey = String(currentSettings?.ai?.apiKey || '');
  await persistCredential(update.apiKey);
  try {
    await saveSettingsWithTrace();
  } catch (error) {
    try {
      await persistCredential(previousKey);
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

function createSettingsUpdateCoordinator({
  loadSettings,
  applySettingsPatch,
  persistCredential,
  saveSettings,
  trace = () => {}
}) {
  let queue = Promise.resolve();

  function submit(patch) {
    const operation = queue.then(async () => {
      trace('settings-coordinator-enter');
      const currentSettings = loadSettings();
      const update = applySettingsPatch(currentSettings, patch);
      trace('settings-patch-applied');
      trace(update.credentialChanged ? 'credential-change-yes' : 'credential-change-no');
      await persistSettingsUpdate({
        currentSettings,
        update,
        persistCredential,
        saveSettings,
        trace
      });
      return update;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  return Object.freeze({ submit });
}

module.exports = { createSettingsUpdateCoordinator, persistSettingsUpdate };
