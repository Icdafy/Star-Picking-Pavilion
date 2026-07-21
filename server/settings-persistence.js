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

module.exports = { persistSettingsUpdate };
