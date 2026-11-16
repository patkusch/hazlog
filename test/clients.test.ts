import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lookup } from '../src/gemini.ts';
import { generateJson, ollamaAvailable } from '../src/ollama.ts';

/**
 * The two model clients, with nothing real behind them: Gemini is a stand-in fetch, Ollama is a tiny
 * server on this machine's loopback address. No key is used and nothing leaves the machine.
 */

const ok = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('the online lookup', () => {
  const saved = process.env.GEMINI_API_KEY;
  after(() => {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  });

  test('without a key it says so and never calls out', async () => {
    delete process.env.GEMINI_API_KEY;
    let called = false;
    const spy = (async () => ((called = true), ok({}))) as unknown as typeof fetch;
    await assert.rejects(() => lookup('anaphylaxis', spy), /GEMINI_API_KEY is not set/);
    assert.equal(called, false);
  });

  test('a term is checked before anything else, so a document line is refused even with a key set', async () => {
    process.env.GEMINI_API_KEY = 'k';
    let called = false;
    const spy = (async () => ((called = true), ok({}))) as unknown as typeof fetch;
    await assert.rejects(() => lookup('first line\nsecond line', spy), /line break/);
    assert.equal(called, false);
  });

  test('the question depends on what the term is: a SNOMED code, an NHS standard, or a plain term', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const bodies: string[] = [];
    const fake = (async (_u: string, init: any) => (bodies.push(JSON.parse(init.body).contents[0].parts[0].text), ok({ candidates: [] }))) as unknown as typeof fetch;
    const snomed = await lookup('716186003', fake);
    const std = await lookup('DCB0160', fake);
    const std2 = await lookup('dcb 0129', fake);
    const term = await lookup('anaphylaxis', fake);
    assert.deepEqual([snomed.kind, std.kind, std2.kind, term.kind], ['snomed', 'standard', 'standard', 'term']);
    assert.match(bodies[0], /preferred term and semantic tag of SNOMED CT concept 716186003/);
    assert.match(bodies[1], /current version, amendment number and publication date of NHS information standard DCB0160/);
    assert.match(bodies[3], /Define the clinical or NHS information-governance term "anaphylaxis" in one sentence\./);
    assert.equal(snomed.sent, bodies[0], 'the result records exactly what was sent');
  });

  test('five-digit numbers and look-alike standards are only plain terms', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const fake = (async () => ok({})) as unknown as typeof fetch;
    assert.equal((await lookup('12345', fake)).kind, 'term');
    assert.equal((await lookup('DCB0170', fake)).kind, 'term');
  });

  test('the key goes in a header, never in the body, and the request is a plain POST with no randomness', async () => {
    process.env.GEMINI_API_KEY = 'secret-key-123';
    let seen: any;
    const fake = (async (url: string, init: any) => ((seen = { url, init }), ok({}))) as unknown as typeof fetch;
    await lookup('anaphylaxis', fake);
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers['x-goog-api-key'], 'secret-key-123');
    assert.equal(seen.init.body.includes('secret-key-123'), false);
    assert.equal(seen.url.includes('secret-key-123'), false);
    assert.equal(JSON.parse(seen.init.body).generationConfig.temperature, 0);
    assert.match(seen.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
  });

  test('the answer is every text part joined and trimmed; no candidates gives an empty answer, not a crash', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const two = (async () => ok({ candidates: [{ content: { parts: [{ text: '  Anaphylaxis ' }, { text: '(disorder)\n' }, {}] } }] })) as unknown as typeof fetch;
    assert.equal((await lookup('anaphylaxis', two)).answer, 'Anaphylaxis (disorder)');
    const none = (async () => ok({})) as unknown as typeof fetch;
    assert.equal((await lookup('anaphylaxis', none)).answer, '');
  });

  test('a refused request is an error that carries the status and the reply', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const refused = (async () => ok('quota used up', 429)) as unknown as typeof fetch;
    await assert.rejects(() => lookup('anaphylaxis', refused), /Gemini 429: quota used up/);
  });

  test('the term is trimmed before it is used', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const fake = (async () => ok({})) as unknown as typeof fetch;
    assert.equal((await lookup('  anaphylaxis  ', fake)).term, 'anaphylaxis');
  });
});

describe('the local model client', () => {
  let server: Server;
  let host: string;
  let next: { status: number; body: string } = { status: 200, body: '{}' };
  const seen: { path?: string; method?: string; body?: any }[] = [];

  before(async () => {
    server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seen.push({ path: req.url, method: req.method, body: data ? JSON.parse(data) : undefined });
        res.statusCode = next.status;
        res.setHeader('content-type', 'application/json');
        res.end(next.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test('it asks the generate endpoint for JSON in the shape of the schema, with a steady temperature', async () => {
    next = { status: 200, body: JSON.stringify({ response: JSON.stringify({ answer: 42 }) }) };
    const out = await generateJson<{ answer: number }>('be brief', 'what is six times seven', { type: 'object' }, { host, model: 'tiny', temperature: 0.3, num_ctx: 2048 });
    assert.deepEqual(out, { answer: 42 });
    const req = seen[seen.length - 1];
    assert.equal(req.path, '/api/generate');
    assert.equal(req.method, 'POST');
    assert.deepEqual(req.body, {
      model: 'tiny',
      system: 'be brief',
      prompt: 'what is six times seven',
      format: { type: 'object' },
      stream: false,
      options: { temperature: 0.3, num_ctx: 2048 },
    });
  });

  test('without options it uses a low temperature and a large window', async () => {
    next = { status: 200, body: JSON.stringify({ response: '{}' }) };
    await generateJson('s', 'p', {}, { host });
    const req = seen[seen.length - 1];
    assert.equal(req.body.options.temperature, 0.1);
    assert.equal(req.body.options.num_ctx, 16384);
  });

  test('a server error is reported with its status and message', async () => {
    next = { status: 500, body: 'model crashed' };
    await assert.rejects(() => generateJson('s', 'p', {}, { host }), /Ollama 500: model crashed/);
  });

  test('an answer that is not JSON is an error that quotes the start of what came back', async () => {
    next = { status: 200, body: JSON.stringify({ response: 'Sure! Here is the answer: ' + 'x'.repeat(600) }) };
    await assert.rejects(
      () => generateJson('s', 'p', {}, { host }),
      (e: Error) => /not valid JSON despite schema constraint/.test(e.message) && e.message.includes('Sure! Here is the answer') && e.message.length < 1000,
    );
  });

  test('only this machine is allowed: localhost, 127.0.0.1 and ::1 pass, anything else is refused before any request', async () => {
    const before = seen.length;
    for (const bad of ['http://192.168.1.20:11434', 'http://0.0.0.0:11434', 'https://api.example.com', 'http://localhost.evil.com:11434', 'http://127.0.0.1.evil.com']) {
      await assert.rejects(() => generateJson('s', 'p', {}, { host: bad }), /never leaves the machine/, bad);
    }
    assert.equal(seen.length, before, 'nothing was sent');
  });

  test('an address that is not a URL at all is refused too', async () => {
    await assert.rejects(() => generateJson('s', 'p', {}, { host: 'not a url' }));
  });

  test('availability lists the models that are installed', async () => {
    next = { status: 200, body: JSON.stringify({ models: [{ name: 'gemma3:4b' }, { name: 'gemma3:12b' }] }) };
    assert.deepEqual(await ollamaAvailable(host), { ok: true, models: ['gemma3:4b', 'gemma3:12b'] });
    assert.equal(seen[seen.length - 1].path, '/api/tags');
    next = { status: 200, body: '{}' };
    assert.deepEqual(await ollamaAvailable(host), { ok: true, models: [] });
  });

  test('availability says why when the server answers with an error, or does not answer', async () => {
    next = { status: 503, body: 'busy' };
    assert.deepEqual(await ollamaAvailable(host), { ok: false, models: [], error: 'HTTP 503' });
    const down = await ollamaAvailable('http://127.0.0.1:1');
    assert.equal(down.ok, false);
    assert.deepEqual(down.models, []);
    assert.ok(down.error && down.error.length > 0);
  });
});
