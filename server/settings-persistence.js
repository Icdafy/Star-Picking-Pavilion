'use strict';

async function persistSettingsUpdate({
  currentSettings,
  update,
  persistCredential,
  saveSettings
}) {
  if (!update?.credentialChanged) {
    await saveSettings(update.settings);
    return;
  }

  const previousKey = String(currentSettings?.ai?.apiKey || '');
  await persistCredential(update.apiKey);
  try {
    await saveSettings(update.settings);
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
      await persistSettingsUpdate({
        currentSettings,
        update,
        persistCredential,
        saveSettings
      });
      return update;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  return Object.freeze({ submit });
}

module.exports = { createSettingsUpdateCoordinator, persistSettingsUpdate };
