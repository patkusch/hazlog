import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { retryFloorCitation, citationRetryPrompt, type HazardEntry } from '../src/passes.ts';
import type { Corpus } from '../src/corpus.ts';

/**
 * Pins the one targeted retry `applySeverityFloor` (src/risk.ts) can trigger
 * through `retryFloorCitation` (src/passes.ts): when `checkFloorCitation`
 * already found a citation gap, one narrow follow-up call shows the model
 * only the evidence line that triggered the floor and asks whether it is
 * actually a cause. The model call itself is mocked here - this file is
 * about the retry's own logic (when it fires, what it sends, what it does
 * with the answer), not about a real model's behaviour. See
 * docs/runs/gemma3-12b/README notes and README Limits for the live result.
 */
function synthCorpus(files: Record<string, string[]>): Corpus {
  return {
    dir: 'synthetic',
    files: Object.entries(files).map(([file, lines]) => ({ file, path: file, sha256: '', lines })),
  };
}

const corpus = synthCorpus({
  'design-a.md': [
    '### SYS-01-R09: Severity Default on Parse Failure',
    'Where no severity can be parsed the record is migrated with severity set to "Unknown" and remains active and visible in the clinical prescribing panel.',
  ],
});

function gapEntry(overrides: Partial<HazardEntry> = {}): HazardEntry {
  return {
    hazard_id: 'HZ-001',
    finding_id: 'F-01',
    hazard_name: 'Conflicting panel visibility',
    hazard_description: 'desc mentions clinical panel',
    causes: ['One design keeps the panel populated, the other keeps it empty.'],
    cited_requirements: [],
    clinical_effect: 'e',
    existing_controls: [],
    proposed_severity: 'Major',
    proposed_likelihood: 'Medium',
    proposed_controls: [],
    proposed_owner_role: 'CSO',
    evidence: [{ file: 'design-a.md', line: 2, excerpt: 'severity set to "Unknown" and remains active and visible', verified: true }],
    standard_refs: [],
    severity_raised: true,
    severity_raised_from: 'Considerable',
    severity_raised_source: { file: 'design-a.md', line: 2 },
    severity_floor_citation_gap: true,
    severity_floor_missing_requirement_id: 'SYS-01-R09',
    ...overrides,
  } as HazardEntry;
}

describe('citationRetryPrompt: shows only the triggering evidence line, not the corpus', () => {
  test('names the requirement, the exact file:line and asks a yes/no question', () => {
    const prompt = citationRetryPrompt(
      { hazard_name: 'Conflicting panel visibility', hazard_description: 'desc', causes: ['a cause'] },
      { file: 'design-a.md', line: 2, excerpt: 'severity set to "Unknown"' },
      'SYS-01-R09',
    );
    assert.match(prompt, /SYS-01-R09/);
    assert.match(prompt, /design-a\.md:2\|/);
    assert.match(prompt, /severity set to "Unknown"/);
    assert.match(prompt, /Conflicting panel visibility/);
  });
});

describe('retryFloorCitation: no gap -> no retry call', () => {
  test('entry without severity_floor_citation_gap is returned unchanged, model never called', async () => {
    let calls = 0;
    const mockGenerate = async () => { calls++; return { cites: true }; };
    const entry = gapEntry({ severity_floor_citation_gap: undefined, severity_floor_missing_requirement_id: undefined });
    const out = await retryFloorCitation(entry, corpus, {}, mockGenerate as never);
    assert.equal(calls, 0, 'the retry must not call the model when there is no gap to close');
    assert.deepEqual(out, entry);
  });

  test('entry with the gap flag but no severity_raised_source (defensive: should not happen in practice) -> no call', async () => {
    let calls = 0;
    const mockGenerate = async () => { calls++; return { cites: true }; };
    const entry = gapEntry({ severity_raised_source: undefined });
    const out = await retryFloorCitation(entry, corpus, {}, mockGenerate as never);
    assert.equal(calls, 0);
    assert.deepEqual(out, entry);
  });
});

describe('retryFloorCitation: gap present -> retry called with the triggering evidence', () => {
  test('the model is shown the exact file, line and excerpt that triggered the floor', async () => {
    let seenPrompt = '';
    let seenSchema: unknown;
    let seenOpts: unknown;
    const mockGenerate = async (_system: string, prompt: string, schema: unknown, opts: unknown) => {
      seenPrompt = prompt;
      seenSchema = schema;
      seenOpts = opts;
      return { cites: true };
    };
    const entry = gapEntry();
    await retryFloorCitation(entry, corpus, { model: 'gemma3:12b' }, mockGenerate as never);
    assert.match(seenPrompt, /design-a\.md:2\|/, 'must show the exact evidence line, not the whole corpus');
    assert.match(seenPrompt, /severity set to "Unknown" and remains active and visible in the clinical prescribing panel/);
    assert.match(seenPrompt, /SYS-01-R09/);
    assert.deepEqual(seenSchema, { type: 'object', required: ['cites'], properties: { cites: { type: 'boolean' } } });
    assert.deepEqual(seenOpts, { model: 'gemma3:12b' });
  });

  test('model confirms (cites: true) -> requirement id is added to cited_requirements, entry marked as retry-confirmed, gap flag cleared', async () => {
    const mockGenerate = async () => ({ cites: true });
    const entry = gapEntry();
    const out = await retryFloorCitation(entry, corpus, {}, mockGenerate as never);
    assert.deepEqual(out.cited_requirements, ['SYS-01-R09']);
    assert.equal(out.severity_floor_citation_retry_confirmed, true);
    assert.equal(out.severity_floor_citation_retry_requirement_id, 'SYS-01-R09');
    assert.equal('severity_floor_citation_gap' in out, false, 'the gap is resolved, so the flag should not still claim there is one');
    assert.equal('severity_floor_missing_requirement_id' in out, false);
    assert.deepEqual(out.causes, entry.causes, 'causes prose is never rewritten, only cited_requirements gains the confirmed id');
  });

  test('model still does not confirm (cites: false) -> entry unchanged, honest flag kept exactly as before', async () => {
    const mockGenerate = async () => ({ cites: false });
    const entry = gapEntry();
    const out = await retryFloorCitation(entry, corpus, {}, mockGenerate as never);
    assert.deepEqual(out, entry, 'nothing about the entry changes when the retry does not confirm');
  });

  test('the model call itself fails -> treated the same as not confirming, honest flag kept', async () => {
    const mockGenerate = async () => { throw new Error('ollama unreachable'); };
    const entry = gapEntry();
    const out = await retryFloorCitation(entry, corpus, {}, mockGenerate as never);
    assert.deepEqual(out, entry);
  });

  test('malformed model response (no cites field) -> treated as not confirming', async () => {
    const mockGenerate = async () => ({} as { cites: boolean });
    const entry = gapEntry();
    const out = await retryFloorCitation(entry, corpus, {}, mockGenerate as never);
    assert.deepEqual(out, entry);
  });
});
