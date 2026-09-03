import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCorpus, verifyCitation } from '../src/corpus.ts';
import { riskRating, MATRIX } from '../src/risk.ts';
import { TWO_FILE_TYPES } from '../src/passes.ts';

/**
 * The committed fixtures are what `make demo` shows a judge. They are held to
 * the same rule as a live run: every excerpt must resolve, every finding must
 * span two files, every rating must be computable from the matrix.
 */
const corpus = loadCorpus('corpus');
const findings = JSON.parse(readFileSync('out/findings.json', 'utf8'));
const hazardLog = JSON.parse(readFileSync('out/hazard-log.json', 'utf8'));
const schema = JSON.parse(readFileSync('shared/schema.json', 'utf8'));

describe('out/findings.json', () => {
  test('every requirement excerpt verifies', () => {
    for (const r of findings.requirements) {
      const v = verifyCitation(corpus, { file: r.file, line: r.line, excerpt: r.excerpt });
      assert.equal(v.verified, true, `${r.id} ${r.file}:${r.line}: ${v.reason} | actual: ${v.actual}`);
    }
  });
  test('every finding source verifies, and every finding spans at least two files', () => {
    for (const f of findings.findings) {
      assert.ok(f.sources.length >= 2, `${f.id} has fewer than two sources`);
      if (TWO_FILE_TYPES.has(f.type)) assert.ok(new Set(f.sources.map((s: any) => s.file)).size >= 2, `${f.id} (${f.type}) cites only one file`);
      for (const s of f.sources) {
        const v = verifyCitation(corpus, s);
        assert.equal(v.verified, true, `${f.id} ${s.file}:${s.line}: ${v.reason} | actual: ${v.actual}`);
      }
    }
  });
  test('finding types and statuses are within the schema enums', () => {
    const types = schema.pass2_findings.properties.findings.items.properties.type.enum;
    const statuses = schema.pass1_requirements.properties.requirements.items.properties.status.enum;
    for (const f of findings.findings) assert.ok(types.includes(f.type), `${f.id} type ${f.type}`);
    for (const r of findings.requirements) assert.ok(statuses.includes(r.status), `${r.id} status ${r.status}`);
  });
});

describe('out/hazard-log.json', () => {
  test('every entry maps to a finding, every evidence excerpt verifies, and evidence spans two files', () => {
    const ids = new Set(findings.findings.map((f: any) => f.id));
    for (const e of hazardLog.entries) {
      assert.ok(ids.has(e.finding_id), `${e.hazard_id} refers to unknown finding ${e.finding_id}`);
      assert.ok(e.evidence.length >= 2, `${e.hazard_id} has fewer than two evidence lines`);
      const type = findings.findings.find((f: any) => f.id === e.finding_id)?.type;
      if (TWO_FILE_TYPES.has(type)) assert.ok(new Set(e.evidence.map((s: any) => s.file)).size >= 2, `${e.hazard_id} (${type}) evidence cites only one file`);
      for (const s of e.evidence) {
        const v = verifyCitation(corpus, s);
        assert.equal(v.verified, true, `${e.hazard_id} ${s.file}:${s.line}: ${v.reason} | actual: ${v.actual}`);
      }
    }
  });
  test('every proposed severity and likelihood is on the DCB0160 scale and yields a rating', () => {
    for (const e of hazardLog.entries) {
      const r = riskRating(e.proposed_severity, e.proposed_likelihood);
      assert.ok(r.rating >= 1 && r.rating <= 5, `${e.hazard_id} rating ${r.rating}`);
      assert.ok(r.acceptability.length > 0);
    }
  });
  test('no entry carries a confirmed rating, a signature or a residual risk: those belong to the CSO', () => {
    for (const e of hazardLog.entries) {
      for (const k of ['risk_rating', 'confirmed_severity', 'confirmed_likelihood', 'signed_by', 'signed_at', 'residual_risk', 'cso_signoff']) {
        assert.equal(k in e, false, `${e.hazard_id} carries ${k}`);
      }
    }
    assert.match(hazardLog.run.note, /Clinical Safety Officer/);
  });
  test('the matrix is Table 9 of the DCB0160 Implementation Guidance v4.2, cell for cell', () => {
    assert.deepEqual(MATRIX.matrix_rows_likelihood_cols_severity, { '1': [1,1,2,2,3], '2': [1,2,2,3,4], '3': [2,2,3,3,4], '4': [2,3,3,4,5], '5': [3,4,4,5,5] });
    assert.deepEqual(MATRIX.severity.map((s) => s.level), ['Minor','Significant','Considerable','Major','Catastrophic']);
    assert.deepEqual(MATRIX.likelihood.map((l) => l.level), ['Very low','Low','Medium','High','Very high']);
    assert.equal(MATRIX.acceptability['5'], 'Unacceptable level of risk');
    assert.equal(MATRIX.acceptability['1'], 'Acceptable, no further action required');
    assert.match(MATRIX.acceptability['3'], /^Undesirable level of risk/);
  });
  test('the matrix is a complete 5x5 with values 1..5, monotone in both directions', () => {
    for (let l = 1; l <= 5; l++) {
      const row = MATRIX.matrix_rows_likelihood_cols_severity[String(l)];
      assert.equal(row.length, 5);
      for (let s = 0; s < 5; s++) {
        assert.ok(row[s] >= 1 && row[s] <= 5);
        if (s > 0) assert.ok(row[s] >= row[s - 1], `severity monotone at L${l} S${s + 1}`);
        if (l > 1) assert.ok(row[s] >= MATRIX.matrix_rows_likelihood_cols_severity[String(l - 1)][s], `likelihood monotone at L${l} S${s + 1}`);
      }
    }
  });
});

/** The archived live runs are unedited model output. They are held to the same rule as the fixture. */
describe('docs/runs/*: every archived live run obeys the provenance rule', () => {
  const manifest = JSON.parse(readFileSync('docs/runs/runs.json', 'utf8'));
  for (const run of manifest.runs.filter((r: any) => r.id !== 'fixture')) {
    const dir = run.path.replace(/^\//, '');
    const lf = JSON.parse(readFileSync(`${dir}/findings.json`, 'utf8'));
    const lh = JSON.parse(readFileSync(`${dir}/hazard-log.json`, 'utf8'));
    test(`${run.id}: engine is GEMMA_LOCAL and every citation resolves`, () => {
      assert.equal(lf.run.engine, 'GEMMA_LOCAL');
      for (const r of lf.requirements) {
        const v = verifyCitation(corpus, { file: r.file, line: r.line, excerpt: r.excerpt });
        assert.equal(v.verified, true, `${run.id} ${r.id} ${r.file}:${r.line}: ${v.reason}`);
      }
      for (const f of lf.findings) {
        assert.ok(f.sources.length >= 2);
        if (TWO_FILE_TYPES.has(f.type)) assert.ok(new Set(f.sources.map((s: any) => s.file)).size >= 2, `${run.id} ${f.id}`);
        for (const s of f.sources) assert.equal(verifyCitation(corpus, s).verified, true, `${run.id} ${f.id} ${s.file}:${s.line}`);
      }
      for (const e of lh.entries) {
        assert.ok(lf.findings.some((f: any) => f.id === e.finding_id));
        for (const s of e.evidence) assert.equal(verifyCitation(corpus, s).verified, true, `${run.id} ${e.hazard_id} ${s.file}:${s.line}`);
        riskRating(e.proposed_severity, e.proposed_likelihood);
        for (const k of ['risk_rating', 'signed_by', 'cso_signoff']) assert.equal(k in e, false);
      }
    });
  }
});
