import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertIsTerm, lookup } from '../src/gemini.ts';

/**
 * The invariant in the README: the corpus never leaves the machine, and
 * Gemini receives only isolated terms. Enforced in code, asserted here.
 */
describe('gemini.ts cannot reach the corpus', () => {
  const src = readFileSync('src/gemini.ts', 'utf8');
  test('imports nothing that can read files or the corpus', () => {
    assert.doesNotMatch(src, /from ['"]\.\/corpus/);
    assert.doesNotMatch(src, /from ['"]\.\/prepass/);
    assert.doesNotMatch(src, /from ['"]\.\/passes/);
    assert.doesNotMatch(src, /node:fs/);
    assert.doesNotMatch(src, /readFileSync|readFile\(|readdirSync/);
  });
  test('the local model client refuses non-local hosts', async () => {
    const { generateJson } = await import('../src/ollama.ts');
    await assert.rejects(() => generateJson('s', 'p', {}, { host: 'https://api.example.com' }), /never leaves the machine/);
  });
});

describe('assertIsTerm refuses document content', () => {
  test('accepts a SNOMED code and a standard reference', () => {
    assertIsTerm('716186003');
    assertIsTerm('DCB0160');
    assertIsTerm('anaphylaxis');
  });
  test('rejects a corpus line', () => {
    const line = readFileSync('corpus/FLLD-DM-v3.md', 'utf8').split('\n')[22];
    assert.throws(() => assertIsTerm(line), /too long|line break/);
  });
  test('rejects multi-line input', () => assert.throws(() => assertIsTerm('a\nb'), /line break/));
  test('rejects an NHS number', () => assert.throws(() => assertIsTerm('943 476 5919'), /NHS number/));
  test('rejects a FILE:LINE citation', () => assert.throws(() => assertIsTerm('FLLD-DM-v3.md:23'), /citation/));
  test('rejects empty', () => assert.throws(() => assertIsTerm('   '), /empty/));
});

describe('lookup sends only the term-derived question', () => {
  test('the request body contains the term and nothing from the corpus', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    let captured = '';
    const fakeFetch = (async (_url: string, init: any) => {
      captured = init.body;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'No known allergy (situation)' }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await lookup('716186003', fakeFetch);
    assert.equal(r.kind, 'snomed');
    assert.match(captured, /716186003/);
    const corpusText = ['FLLD-DM-v3.md', 'FLLD-CLIN-v2.md', 'field-mapping.csv', 'teams-export.txt'].map((f) => readFileSync(`corpus/${f}`, 'utf8')).join('\n');
    for (const l of corpusText.split('\n')) {
      if (l.trim().length >= 20) assert.equal(captured.includes(l.trim()), false, `corpus line leaked: ${l.slice(0, 40)}`);
    }
    assert.ok(captured.length < 600, 'request is a short question, not a document');
  });
});
