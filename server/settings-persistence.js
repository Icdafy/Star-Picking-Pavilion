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
  await persistCredential(update.apiKey, update.credentialProvider);
  try {
    await saveSettingsWithTrace();
  } catch (error) {
    try {
      await persistCredential(previousKey, update.credentialProvider);
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

// 多提供商事务（设置页「模型」一节）：credentials 是 { provider: 新密钥 | '' } 的变更表，
// previousCredentials 是同一批提供商的旧值。先写凭据再写设置；设置落盘失败时逐个回滚凭据，
// 与单密钥路径同一顺序与语义。
async function persistModelUpdate({
  update,
  previousCredentials = {},
  persistProviderCredential,
  saveSettings,
  trace = () => {}
}) {
  const changed = Object.entries(update?.credentials || {});
  const written = [];
  try {
    for (const [provider, value] of changed) {
      await persistProviderCredential(provider, value);
      written.push(provider);
    }
    if (update.settings) {
      trace('settings-save-start');
      await saveSettings(update.settings);
      trace('settings-save-complete');
    }
  } catch (error) {
    for (const provider of written.reverse()) {
      try {
        await persistProviderCredential(provider, previousCredentials[provider] || '');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  }
}

function createSettingsUpdateCoordinator({
  loadSettings,
  applySettingsPatch,
  persistCredential,
  persistProviderCredential,
  readProviderCredential = () => '',
  saveSettings,
  trace = () => {}
}) {
  let queue = Promise.resolve();

  function enqueue(work) {
    const operation = queue.then(work);
    queue = operation.catch(() => {});
    return operation;
  }

  function submit(patch) {
    return enqueue(async () => {
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
  }

  // mutate(currentSettings) → { settings?, credentials?, result? }；与 submit 共用一条队列，
  // 设置页的两类写入不会交错覆盖彼此。
  function transact(mutate) {
    return enqueue(async () => {
      const currentSettings = loadSettings();
      const update = await mutate(currentSettings);
      const previousCredentials = Object.fromEntries(
        Object.keys(update?.credentials || {}).map(provider => [provider, readProviderCredential(provider)])
      );
      await persistModelUpdate({
        update,
        previousCredentials,
        persistProviderCredential,
        saveSettings,
        trace
      });
      return update?.result;
    });
  }

  return Object.freeze({ submit, transact });
}

module.exports = { createSettingsUpdateCoordinator, persistSettingsUpdate, persistModelUpdate };
