'use strict';

const { createUiPreferencesStore, getDefaultUiPreferences } = require('./ui-preferences');

function registerUiPreferencesIpc({ ipcMain, getStore, onUpdated = () => {} }) {
  ipcMain.on('preferences:get', event => {
    const store = getStore();
    event.returnValue = {
      preferences: store ? store.getSnapshot() : getDefaultUiPreferences(),
      hasStoredPreferences: store ? store.hasStoredPreferences() === true : false
    };
  });

  ipcMain.handle('preferences:update', async (_event, patch) => {
    const store = getStore();
    if (!store) throw new Error('UI preferences are not ready');
    const snapshot = await store.update(patch);
    await onUpdated(snapshot, patch);
    return snapshot;
  });
}

async function loadUiPreferencesStore({
  directory,
  createStore = createUiPreferencesStore
}) {
  const store = createStore({ directory });
  await store.load();
  return store;
}

module.exports = {
  registerUiPreferencesIpc,
  loadUiPreferencesStore
};
