import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, getLine } from '../src/corpus.ts';
import { buildIndex } from '../src/prepass.ts';

const corpus = loadCorpus('corpus');
const idx = buildIndex(corpus);

describe('pass 0 index', () => {
  test('finds every requirement heading in both designs', () => {
    const ids = idx.requirement_ids.filter((r) => r.heading).map((r) => r.id).sort();
    assert.deepEqual(ids.filter((i) => i.startsWith('DM-')), ['DM-04-R01','DM-04-R02','DM-04-R03','DM-04-R04','DM-04-R05','DM-04-R06','DM-04-R07','DM-04-R08','DM-04-R09']);
    assert.deepEqual(ids.filter((i) => i.startsWith('CLIN-')), ['CLIN-11-R01','CLIN-11-R02','CLIN-11-R03','CLIN-11-R04','CLIN-11-R05','CLIN-11-R06']);
  });
  test('every indexed location points at a real line containing the thing', () => {
    for (const r of idx.requirement_ids) assert.ok(getLine(corpus, r.file, r.line)?.includes(r.id));
    for (const a of idx.approvals) assert.ok(getLine(corpus, a.file, a.line)?.includes(a.name));
    for (const c of idx.chat_messages) assert.ok(getLine(corpus, c.file, c.line)?.includes(c.speaker));
    for (const s of idx.snomed_codes) assert.ok(getLine(corpus, s.file, s.line)?.includes(s.code));
  });
  test('approval blocks carry name, role and date', () => {
    const cso = idx.approvals.find((a) => a.name === 'Dr Fiona Gallagher')!;
    assert.match(cso.role, /Clinical Safety Officer/);
    assert.equal(cso.date, '19-Feb-2026');
  });
  test('csv rows are parsed by header', () => {
    const row6 = idx.csv_rows.find((r) => r.Row === '6')!;
    assert.equal(row6.Migrate, 'N');
    assert.equal(row6.line, 7);
  });
  test('identifiable data is flagged by location only, never by value', () => {
    const kinds = new Set(idx.identifiable_data.map((x) => x.kind));
    for (const k of ['nhs_number', 'date_of_birth', 'contract_value', 'safeguarding', 'named_clinician']) assert.ok(kinds.has(k), k);
    const json = JSON.stringify(idx.identifiable_data);
    assert.doesNotMatch(json, /\d{3} \d{3} \d{4}/);
    assert.doesNotMatch(json, /Ramasubramanian|Okafor/);
  });
});
