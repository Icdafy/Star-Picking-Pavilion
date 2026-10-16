'use strict';
// 新闻推送的 HTTP 面：设置页「新闻推送」一节的全部读写。连接信息只进不出，响应里只有掩码摘要。
const { HttpError } = require('../http-security');

function plainBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '请求体必须是对象');
  return value;
}

function asHttpError(error) {
  if (error instanceof HttpError) return error;
  if (error?.statusCode >= 400 && error.statusCode < 500) return new HttpError(error.statusCode, error.message);
  return error;
}

function createPushRoutes({ service }) {
  if (!service) throw new TypeError('push service is required');

  async function handle({ req, res, pathname, json, readJsonBody }) {
    if (!pathname.startsWith('/api/push')) return false;
    try {
      if (pathname === '/api/push' && req.method === 'GET') {
        json(res, 200, service.view());
        return true;
      }
      if (pathname === '/api/push/settings' && req.method === 'POST') {
        await service.updateSettings(plainBody(await readJsonBody(req)));
        json(res, 200, service.view());
        return true;
      }
      if (pathname === '/api/push/preview' && req.method === 'GET') {
        json(res, 200, service.preview());
        return true;
      }
      if (pathname === '/api/push/run' && req.method === 'POST') {
        const result = await service.runPush('manual');
        json(res, 200, { ...result, view: service.view() });
        return true;
      }
      const match = pathname.match(/^\/api\/push\/channels\/([a-z]{2,16})(?:\/(bind|verify|test|enabled))?$/);
      if (!match) return false;
      const [, id, action] = match;
      if (!action && req.method === 'DELETE') {
        await service.unbind(id);
        json(res, 200, service.view());
        return true;
      }
      if (req.method !== 'POST' || !action) return false;
      const body = plainBody(await readJsonBody(req));
      if (action === 'bind') json(res, 200, await service.startBinding(id, body));
      else if (action === 'verify') json(res, 200, { ...await service.confirmBinding(id, body.code), view: service.view() });
      else if (action === 'test') json(res, 200, await service.testChannel(id));
      else {
        await service.setChannelEnabled(id, body.enabled);
        json(res, 200, service.view());
      }
      return true;
    } catch (error) {
      throw asHttpError(error);
    }
  }

  return Object.freeze({ handle });
}

module.exports = { createPushRoutes };
