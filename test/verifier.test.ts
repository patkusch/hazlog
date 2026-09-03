import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, corpusLines, verifyCitation, MIN_EXCERPT, prefixedCorpus, getLine } from '../src/corpus.ts';

/**
 * The one load-bearing claim: a citation is FILE:LINE and it is checked in
 * code. So the verifier is the only place a bug is actively dishonest. These
 * tests mostly try to get a fabricated citation past it. Several of them are
 * the exact holes Aurora's verifier had.
 */
const corpus = loadCorpus('corpus');
const lines = corpusLines(corpus);
const realLong = lines.find((l) => l.text.trim().length > 60)!;

describe('verifyCitation rejects fabrication', () => {
  test('file that does not exist', () => {
    assert.equal(verifyCitation(corpus, { file: 'FLLD-INVENTED-99.md', line: 1, excerpt: 'anything at all here' }).verified, false);
  });
  test('line past the end of a real file', () => {
    const f = corpus.files[0];
    assert.equal(verifyCitation(corpus, { file: f.file, line: f.lines.length + 1, excerpt: 'anything at all here' }).verified, false);
  });
  test('line 0, negative, fractional and NaN lines', () => {
    for (const line of [0, -1, 1.5, NaN]) {
      assert.equal(verifyCitation(corpus, { file: realLong.file, line, excerpt: realLong.text }).verified, false, `line ${line}`);
    }
  });
  test('excerpt that is not on the cited line', () => {
    const r = verifyCitation(corpus, { file: realLong.file, line: realLong.line, excerpt: 'the system shall immediately delete all patient records' });
    assert.equal(r.verified, false);
  });
  test('fabricated quote against every blank line in the corpus (Aurora bug)', () => {
    const blanks = lines.filter((l) => l.text.trim() === '');
    assert.ok(blanks.length > 0, 'precondition: corpus has blank lines');
    for (const b of blanks) {
      assert.equal(verifyCitation(corpus, { file: b.file, line: b.line, excerpt: 'legacy data shall be deleted' }).verified, false);
    }
  });
  test('empty and whitespace excerpts against every line (Aurora bug)', () => {
    for (const l of lines) {
      assert.equal(verifyCitation(corpus, { file: l.file, line: l.line, excerpt: '' }).verified, false);
      assert.equal(verifyCitation(corpus, { file: l.file, line: l.line, excerpt: '   \t ' }).verified, false);
    }
  });
  test('reverse containment: the whole line plus extra words is not a verbatim excerpt', () => {
    const r = verifyCitation(corpus, { file: realLong.file, line: realLong.line, excerpt: realLong.text + ' and also this invented clause' });
    assert.equal(r.verified, false);
  });
  test('excerpt shorter than MIN_EXCERPT is rejected even when it matches', () => {
    const word = realLong.text.trim().split(/\s+/).find((w) => w.length >= 3 && w.length < MIN_EXCERPT)!;
    assert.equal(verifyCitation(corpus, { file: realLong.file, line: realLong.line, excerpt: word }).verified, false);
  });
  test('excerpt from the right file but the wrong line is rejected', () => {
    const other = lines.find((l) => l.file === realLong.file && l.line !== realLong.line && l.text.trim().length > 60)!;
    assert.equal(verifyCitation(corpus, { file: realLong.file, line: other.line, excerpt: realLong.text }).verified, false);
  });
  test('excerpt from a different file at a line that exists is rejected', () => {
    const other = lines.find((l) => l.file !== realLong.file && l.text.trim().length > 60)!;
    assert.equal(verifyCitation(corpus, { file: other.file, line: other.line, excerpt: realLong.text }).verified, false);
  });
});

describe('verifyCitation accepts what is really there', () => {
  test('every non-blank corpus line verifies against itself', () => {
    for (const l of lines) {
      if (l.text.trim().length < MIN_EXCERPT) continue;
      const r = verifyCitation(corpus, { file: l.file, line: l.line, excerpt: l.text });
      assert.equal(r.verified, true, `${l.file}:${l.line}: ${r.reason}`);
    }
  });
  test('a substring of a line verifies', () => {
    const t = realLong.text.trim();
    const sub = t.slice(10, 10 + Math.max(MIN_EXCERPT, 30));
    assert.equal(verifyCitation(corpus, { file: realLong.file, line: realLong.line, excerpt: sub }).verified, true);
  });
  test('case, curly quotes, dashes and whitespace runs are normalised', () => {
    const l = lines.find((x) => x.text.includes('"Unknown"'))!;
    const messy = l.text.replace(/"Unknown"/, '“UNKNOWN”').replace(/ /g, '  ');
    assert.equal(verifyCitation(corpus, { file: l.file, line: l.line, excerpt: messy }).verified, true);
  });
});

describe('prefixed corpus is the same text the verifier checks', () => {
  test('every prefixed line round-trips to getLine', () => {
    for (const row of prefixedCorpus(corpus).split('\n')) {
      const m = row.match(/^([^:]+):(\d+)\| (.*)$/);
      assert.ok(m, row);
      assert.equal(getLine(corpus, m![1], Number(m![2])), m![3]);
    }
  });
});
