'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

async function atomicWrite(destination, content) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.promises.writeFile(temporary, content, { mode: 0o600 });
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function createCredentialStore({ safeStorage, directory }) {
  if (!safeStorage || !directory) throw new TypeError('safeStorage and directory are required');
  const file = path.join(directory, 'credentials.v1.json');

  function requireEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 安全加密不可用，拒绝保存 API Key');
    }
  }

  async function get() {
    if (!fs.existsSync(file)) return '';
    requireEncryption();
    const envelope = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    if (envelope?.version !== 1 || typeof envelope.ciphertext !== 'string') {
      throw new Error('加密凭据文件格式无效');
    }
    return safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
  }

  async function set(value) {
    const secret = String(value || '').trim();
    if (!secret) {
      await fs.promises.rm(file, { force: true });
      return;
    }
    requireEncryption();
    const ciphertext = safeStorage.encryptString(secret);
    await atomicWrite(file, JSON.stringify({
      version: 1,
      ciphertext: ciphertext.toString('base64')
    }, null, 2));
  }

  async function migratePlaintextSettings(settingsFile) {
    if (!fs.existsSync(settingsFile)) return false;
    const serialized = await fs.promises.readFile(settingsFile, 'utf8');
    let settings;
    try { settings = JSON.parse(serialized); } catch { return false; }
    const legacyKey = String(settings?.ai?.apiKey || '').trim();
    if (!legacyKey) return false;

    await set(legacyKey);
    if (await get() !== legacyKey) throw new Error('加密凭据回读验证失败');
    delete settings.ai.apiKey;
    await atomicWrite(settingsFile, JSON.stringify(settings, null, 2));
    return true;
  }

  return Object.freeze({ file, get, set, migratePlaintextSettings });
}

module.exports = { createCredentialStore };
