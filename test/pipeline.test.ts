import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { runPipeline } from '../src/passes.ts';

/**
 * The whole local path, end to end, against a fake Ollama on loopback that
 * returns canned JSON. The canned Pass 2 output includes one finding with a
 * fabricated citation, one whose sources all sit in one file, and one that is
 * real. Only the real one may survive, and the other two must be recorded
 * under `dropped` with a reason. This is the promise on the README: a finding
 * whose quote is not on the line it claims is discarded, not surfaced.
 */
const PASS1 = { requirements: [
  { id: 'DM-04-R05', statement: 'x', file: 'FLLD-DM-v3.md', line: 32, excerpt: 'severity defaulted to "Unknown"', author: 'David Vance', date: '14-Jan-2026', status: 'APPROVED', workstream: 'DM' },
  { id: 'CLIN-11-R01', statement: 'x', file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'unpopulated and empty at go-live', author: 'Dr Fiona Gallagher', date: '19-Feb-2026', status: 'APPROVED', workstream: 'CLIN' },
  { id: 'FAKE-01', statement: 'invented', file: 'FLLD-DM-v3.md', line: 32, excerpt: 'legacy records shall be deleted at go-live', author: '?', date: '?', status: 'APPROVED', workstream: 'DM' },
] };
const PASS2 = { findings: [
  { id: 'c1', type: 'CONTRADICTION', title: 'real', why_incompatible: 'x', clinical_consequence: 'y', sources: [
    { file: 'FLLD-DM-v3.md', line: 32, excerpt: 'severity defaulted to "Unknown"' },
    { file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'unpopulated and empty at go-live' } ] },
  { id: 'c2', type: 'CONTRADICTION', title: 'fabricated quote', why_incompatible: 'x', clinical_consequence: 'y', sources: [
    { file: 'FLLD-DM-v3.md', line: 32, excerpt: 'severity defaulted to "Unknown"' },
    { file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'the panel shall be fully populated at go-live' } ] },
  { id: 'c3', type: 'CONTRADICTION', title: 'single file', why_incompatible: 'x', clinical_consequence: 'y', sources: [
    { file: 'FLLD-DM-v3.md', line: 26, excerpt: 'immediately visible and active' },
    { file: 'FLLD-DM-v3.md', line: 32, excerpt: 'severity defaulted to "Unknown"' } ] },
] };
const PASS3 = { entries: [
  { finding_id: 'F-01', hazard_name: 'h', hazard_description: 'd', causes: ['c'], clinical_effect: 'e', existing_controls: [], proposed_severity: 'Major', proposed_likelihood: 'High', proposed_controls: ['p'], proposed_owner_role: 'CSO', evidence: [
    { file: 'FLLD-DM-v3.md', line: 32, excerpt: 'severity defaulted to "Unknown"' },
    { file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'unpopulated and empty at go-live' } ] },
  { finding_id: 'F-01', hazard_name: 'bad scale', hazard_description: 'd', causes: [], clinical_effect: 'e', existing_controls: [], proposed_severity: 'Extreme', proposed_likelihood: 'High', proposed_controls: [], proposed_owner_role: 'CSO', evidence: [
    { file: 'FLLD-DM-v3.md', line: 32, excerpt: 'severity defaulted to "Unknown"' },
    { file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'unpopulated and empty at go-live' } ] },
  { finding_id: 'F-99', hazard_name: 'orphan', hazard_description: 'd', causes: [], clinical_effect: 'e', existing_controls: [], proposed_severity: 'Minor', proposed_likelihood: 'Low', proposed_controls: [], proposed_owner_role: 'CSO', evidence: [
    { file: 'FLLD-DM-v3.md', line: 32, excerpt: 'severity defaulted to "Unknown"' },
    { file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'unpopulated and empty at go-live' } ] },
] };

let server: Server; let host = ''; const prompts: string[] = []; let call = 0;
before(async () => {
  server = createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      const j = JSON.parse(body); prompts.push(j.prompt);
      const canned = [PASS1, PASS2, PASS3][call++];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ response: JSON.stringify(canned) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

describe('runPipeline against a fake local model', () => {
  test('keeps only what verifies and records why the rest was dropped', async () => {
    const r = await runPipeline('corpus', { host, model: 'fake' });
    assert.equal(call, 3, 'three passes, three calls');
    assert.deepEqual(r.findings.requirements.map((x) => x.id), ['DM-04-R05', 'CLIN-11-R01']);
    assert.deepEqual(r.findings.findings.map((f) => f.title), ['real']);
    assert.equal(r.findings.findings[0].id, 'F-01');
    assert.ok(r.findings.findings[0].sources.every((s) => s.verified === true));
    const reasons = Object.fromEntries(r.findings.dropped.map((d) => [d.id, d.reason]));
    assert.match(reasons['FAKE-01'], /not on the cited line/);
    assert.match(reasons['c2'], /not on the cited line/);
    assert.match(reasons['c3'], /one file/);
    assert.match(reasons['F-99'], /not verified/);
    const badScale = r.findings.dropped.find((d) => d.pass === 3 && d.reason.includes('unknown severity'));
    assert.ok(badScale, 'an off-scale severity is dropped, not coerced');
    assert.equal(r.hazardLog.entries.length, 1);
    assert.equal(r.hazardLog.entries[0].hazard_id, 'HZ-001');
    assert.equal(r.findings.run.engine, 'GEMMA_LOCAL');
    assert.equal(r.findings.dropped.length, 5);
  });
  test('every prompt carried the FILE:LINE-prefixed corpus and only went to loopback', () => {
    for (const p of prompts) assert.match(p, /FLLD-DM-v3\.md:32\| /);
    assert.match(host, /^http:\/\/127\.0\.0\.1:/);
  });
});
