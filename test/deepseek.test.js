'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { chat, extractJson } = require('../server/ai/deepseek');

function settings(baseUrl = 'https://models.example/v1') {
  return { ai: { apiKey: 'sk-test-only', baseUrl, requestTimeoutMs: 1000 } };
}

test('requests use the model selected in settings, defaulting to Flash Vision', async () => {
  const payloads = [];
  const fetchImpl = async (url, options) => { payloads.push(JSON.parse(options.body)); return response(); };
  await chat([{role:'user',content:'test'}], { settings: settings(), fetchImpl });
  await chat([{role:'user',content:'test'}], {
    settings: {...settings(), ai: {...settings().ai, model:'moonshot-v1-8k'}}, fetchImpl
  });
  await chat([{role:'user',content:'test'}], { settings: settings(), model: 'explicit-model', fetchImpl });
  assert.deepEqual(payloads.map(payload => payload.model), ['deepseek-v4-flash-vision-exp', 'moonshot-v1-8k', 'explicit-model']);
});

test('thinking extensions are only sent to DeepSeek; keyless local endpoints send no Authorization', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, headers: options.headers, body: JSON.parse(options.body) }); return response(); };
  await chat([{role:'user',content:'test'}], {
    settings: { ai: { ...settings().ai, activeProvider: 'openai', providerName: 'OpenAI', model: 'gpt-x' } }, fetchImpl
  });
  await chat([{role:'user',content:'test'}], {
    settings: { ai: { ...settings('http://127.0.0.1:11434/v1').ai, apiKey: 'spp-keyless-endpoint', activeProvider: 'ollama', model: 'qwen3' } }, fetchImpl
  });
  assert.equal('thinking' in calls[0].body, false);
  assert.equal(calls[0].headers.Authorization, 'Bearer sk-test-only');
  assert.equal(calls[1].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal('Authorization' in calls[1].headers, false);
});

test('anthropic-messages providers speak the Messages protocol with images and a separate system prompt', async () => {
  let call;
  const text = '{"ok":true}';
  const result = await chat([
    { role: 'system', content: '只输出 JSON' },
    { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }
  ], {
    settings: { ai: { ...settings('https://api.anthropic.com').ai, api: 'anthropic-messages', activeProvider: 'anthropic', providerName: 'Anthropic', model: 'claude-x' } },
    fetchImpl: async (url, options) => {
      call = { url, headers: options.headers, body: JSON.parse(options.body) };
      return response({ chunks: [JSON.stringify({ content: [{ type: 'text', text }] })] });
    }
  });
  assert.equal(result, text);
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'], 'sk-test-only');
  assert.equal(call.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.body.system, '只输出 JSON');
  assert.equal(call.body.model, 'claude-x');
  assert.deepEqual(call.body.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
});

test('model discovery reports only what the endpoint lists, and a stored key never leaves as a header to an unknown scheme', async () => {
  const { discoverModels } = require('../server/ai/deepseek');
  let request;
  const models = await discoverModels({
    baseUrl: 'https://gateway.example/v1', apiKey: 'sk-typed',
    fetchImpl: async (url, options) => {
      request = { url, headers: options.headers };
      return response({ chunks: [JSON.stringify({ data: [
        { id: 'b-model', context_length: 131072, architecture: { input_modalities: ['text', 'image'] } },
        { id: 'a-model', name: 'A Model' },
        { id: 'a-model' },
        { id: '' }
      ] })] });
    }
  });
  assert.equal(request.url, 'https://gateway.example/v1/models');
  assert.equal(request.headers.Authorization, 'Bearer sk-typed');
  assert.deepEqual(models, [
    { id: 'a-model', name: 'A Model' },
    { id: 'b-model', contextWindow: 131072, input: ['text', 'image'] }
  ]);
  await assert.rejects(discoverModels({ baseUrl: 'http://gateway.example/v1', fetchImpl: async () => response() }), /HTTPS/);
});

function response({ contentLength, chunks = ['{"choices":[{"message":{"content":"ok"}}]}'] } = {}) {
  return {
    ok: true,
    status: 200,
    url: 'https://models.example/v1/chat/completions',
    headers: { get: name => name === 'content-length' && contentLength != null ? String(contentLength) : null },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield Buffer.from(chunk);
      }
    }
  };
}

// 可控制状态码与 Retry-After 头的桩响应；chat 对非 200 也会读 body，故同样走 asyncIterator
function stubResponse({ status = 200, retryAfter = null, body = '{"choices":[{"message":{"content":"ok"}}]}' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://models.example/v1/chat/completions',
    headers: {
      get: name => {
        const lower = String(name).toLowerCase();
        if (lower === 'content-length') return String(Buffer.byteLength(body));
        if (lower === 'retry-after') return retryAfter;
        return null;
      }
    },
    body: {
      async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
    }
  };
}

function completionBody(content, { finishReason = 'stop', reasoning = null } = {}) {
  return JSON.stringify({
    choices: [{
      finish_reason: finishReason,
      message: reasoning === null
        ? { content }
        : { content, reasoning_content: reasoning }
    }]
  });
}

test('AI client rejects an unsafe stored base URL before sending the credential', async () => {
  let calls = 0;
  await assert.rejects(chat([{ role: 'user', content: 'test' }], {
    settings: settings('http://attacker.example/v1'),
    model: 'example',
    fetchImpl: async () => { calls++; return response(); }
  }), /HTTPS|地址/);
  assert.equal(calls, 0);
});

test('AI client bounds remote response bodies before parsing JSON', async () => {
  await assert.rejects(chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    maxResponseBytes: 16,
    fetchImpl: async () => response({ contentLength: 17, chunks: [] })
  }), /16.*字节|过大/);

  const out = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    maxResponseBytes: 128,
    fetchImpl: async () => response()
  });
  assert.equal(out, 'ok');
});

// ---------- M2：429/5xx/网络错误的指数退避重试 ----------

test('M2: a 429 is retried with backoff and the call succeeds on the second attempt', async () => {
  let calls = 0;
  const started = Date.now();
  const out = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? stubResponse({ status: 429, body: '{"error":"rate limited"}' }) : response();
    }
  });
  assert.equal(out, 'ok');
  assert.equal(calls, 2, '429 后必须重试一次');
  // 无 Retry-After 时首次退避 BASE_BACKOFF_MS=500ms
  assert.ok(Date.now() - started >= 450, '重试前应有退避等待');
});

test('M2: Retry-After header overrides the default backoff', async () => {
  let calls = 0;
  const started = Date.now();
  const out = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async () => {
      calls++;
      // Retry-After: 0 → 立即重试；若被忽略会按默认退避等 ≥500ms
      return calls === 1 ? stubResponse({ status: 429, retryAfter: '0', body: '{}' }) : response();
    }
  });
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 450, 'Retry-After=0 应覆盖默认退避，几乎不等待');
});

test('M2: retries are capped — persistent 503 surfaces as an error after 3 attempts', async () => {
  let calls = 0;
  await assert.rejects(chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async () => { calls++; return stubResponse({ status: 503, body: 'unavailable' }); }
  }), /HTTP 503/);
  assert.equal(calls, 3, '首次 + 最多 2 次重试');
});

test('M2: network errors are retried like 5xx', async () => {
  let calls = 0;
  const out = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed: socket hang up');
      return response();
    }
  });
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
});

test('a 400 mentioning the thinking parameter retries once without it', async () => {
  const bodies = [];
  let calls = 0;
  const out = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async (url, options) => {
      calls++;
      bodies.push(JSON.parse(options.body));
      return calls === 1
        ? stubResponse({ status: 400, body: '{"error":"unsupported parameter: thinking"}' })
        : response();
    }
  });
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
  assert.equal('thinking' in bodies[1], false, '重发时必须删掉 thinking 参数');
});

test('a 400 unrelated to thinking still gets one unconditional param-drop retry', async () => {
  const bodies = [];
  let calls = 0;
  await assert.rejects(chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async (url, options) => {
      calls++;
      bodies.push(JSON.parse(options.body));
      return stubResponse({ status: 400, body: '{"error":"invalid api key"}' });
    }
  }), /HTTP 400/);
  // 无法识别的报错文案也保留一次删参重发兜底，第三方兼容服务不会静默退化
  assert.equal(calls, 2, '首次 + 一次无条件删参重发');
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
  assert.equal('thinking' in bodies[1], false, '兜底重发同样删掉 thinking 参数');
});

test('a Chinese "不支持的参数" 400 from a third-party service retries once without the param', async () => {
  const bodies = [];
  let calls = 0;
  const out = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async (url, options) => {
      calls++;
      bodies.push(JSON.parse(options.body));
      return calls === 1
        ? stubResponse({ status: 400, body: '{"error":"不支持的参数: thinking"}' })
        : response();
    }
  });
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
  assert.equal('thinking' in bodies[1], false);
});

test('a moderation-style 400 is never retried', async () => {
  let calls = 0;
  await assert.rejects(chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async () => {
      calls++;
      return stubResponse({ status: 400, body: '{"error":"content blocked by moderation policy"}' });
    }
  }), /HTTP 400/);
  assert.equal(calls, 1, '内容审核拒绝不得删参重发');

  const zhCalls = { n: 0 };
  await assert.rejects(chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async () => {
      zhCalls.n++;
      return stubResponse({ status: 400, body: '{"error":"内容涉嫌违规，已被审核拦截"}' });
    }
  }), /HTTP 400/);
  assert.equal(zhCalls.n, 1, '中文审核拒绝同样不重发');
});

// ---------- L6：reasoning_content 兕底仅限被截断的输出 ----------

test('reasoning_content is only used when the answer was truncated (finish_reason=length)', async () => {
  const truncated = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async () => stubResponse({
      body: completionBody(null, { finishReason: 'length', reasoning: '{"rescued":true}' })
    })
  });
  assert.equal(truncated, '{"rescued":true}');

  const stopped = await chat([{ role: 'user', content: 'test' }], {
    settings: settings(),
    model: 'example',
    fetchImpl: async () => stubResponse({
      body: completionBody(null, { finishReason: 'stop', reasoning: '{"half_baked":true}' })
    })
  });
  assert.equal(stopped, '', '未截断的空响应不得拿思考链冒充答案');
});

// ---------- extractJson：括号配平线性扫描与 64KB 上限 ----------

test('extractJson balances braces while skipping string literals and escapes', () => {
  // 字符串里塞着假括号与转义字符，配平扫描不能被它们骗到
  const out = extractJson('前缀噪音 {"k":"}{","n":"a\\nb"} 尾巴');
  assert.deepEqual(out, { k: '}{', n: 'a\nb' });
  assert.equal(extractJson('完全没有 JSON 的纯文本'), null);
  assert.equal(extractJson(''), null);
  assert.equal(extractJson(null), null);
});

test('extractJson refuses to scan inputs above the 64KB cap', () => {
  const huge = 'x'.repeat(64 * 1024 + 1) + '{"a":1}';
  assert.equal(extractJson(huge), null, '超限输入不再花 CPU 去配平');
  // 上限以内仍可扫描（同样内容只是填充更短）
  const small = 'x'.repeat(1024) + '{"a":1}';
  assert.deepEqual(extractJson(small), { a: 1 });
});
