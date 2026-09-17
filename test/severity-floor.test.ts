import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, type Corpus } from '../src/corpus.ts';
import { checkSeverityFloor, applySeverityFloor, severityScore, SEVERITY_FLOOR_LEVEL, requirementIdAt, checkFloorCitation } from '../src/risk.ts';

/**
 * Pins the one calibration rule that is code, not prompt: a hazard whose
 * evidence already cites a document that explicitly declares its own
 * severity "Unknown" on a field kept active/visible/live on a clinical or
 * prescribing panel is never scored below Major, whatever the model
 * proposed. The unresolved "Unknown" is the aggravating fact, not one more
 * input into an average (see src/risk.ts for the reasoning).
 *
 * A synthetic corpus is used so this test does not depend on the real
 * corpus wording; the real-corpus case (DM-04-R05 and HZ-001) is pinned
 * separately below and is what the README's live 12B run shows.
 */
function synthCorpus(files: Record<string, string[]>): Corpus {
  return {
    dir: 'synthetic',
    files: Object.entries(files).map(([file, lines]) => ({ file, path: file, sha256: '', lines })),
  };
}

describe('checkSeverityFloor / applySeverityFloor: explicit Unknown severity on a live clinical panel', () => {
  test('fixture WITH the condition: raised to Major, with a note explaining why', () => {
    const corpus = synthCorpus({
      'design-a.md': [
        'Where no severity can be parsed the record is migrated with severity set to "Unknown" and remains active and visible in the clinical prescribing panel.',
      ],
      'design-b.md': [
        'The clinical panel shall be empty at go-live for all migrated patients.',
      ],
    });
    const entry = {
      hazard_name: 'Conflicting panel visibility',
      hazard_description: 'One design keeps an Unknown-severity record visible in the clinical panel; the other assumes it is empty.',
      causes: ['design-a.md defaults unparsed severity to Unknown and keeps it active', 'design-b.md assumes an empty panel'],
      proposed_severity: 'Considerable',
      severity_rationale: 'Model rationale here.',
      evidence: [
        { file: 'design-a.md', line: 1, excerpt: 'severity set to "Unknown" and remains active and visible' },
        { file: 'design-b.md', line: 1, excerpt: 'The clinical panel shall be empty at go-live' },
      ],
    };

    const check = checkSeverityFloor(corpus, entry);
    assert.equal(check.raised, true);
    assert.deepEqual(check.source, { file: 'design-a.md', line: 1 });

    const out = applySeverityFloor(corpus, entry);
    assert.equal(out.proposed_severity, 'Major');
    assert.equal(out.severity_raised, true);
    assert.equal(out.severity_raised_from, 'Considerable');
    assert.match(out.severity_raised_reason!, /Raised from Considerable to Major/);
    assert.match(out.severity_raised_reason!, /design-a\.md:1/);
    assert.match(out.severity_rationale!, /Raised from Considerable to Major/, 'the raise note travels with severity_rationale, which is what the hazard log entry shows');
    assert.match(out.severity_rationale!, /Model rationale here\.$/, 'the model\'s own rationale is kept, not discarded');
  });

  test('fixture WITHOUT the condition (ordinary contradiction, no explicit Unknown severity): unchanged', () => {
    const corpus = synthCorpus({
      'design-a.md': ['Ward location codes are migrated via a lookup table maintained by Migration.'],
      'design-b.md': ['Ward location codes are assigned by Clinical Design at go-live.'],
    });
    const entry = {
      hazard_name: 'Ward code ownership conflict',
      hazard_description: 'Two documents disagree about who assigns ward location codes.',
      causes: ['design-a.md assigns Migration', 'design-b.md assigns Clinical Design'],
      proposed_severity: 'Considerable',
      severity_rationale: 'Model rationale here.',
      evidence: [
        { file: 'design-a.md', line: 1, excerpt: 'migrated via a lookup table maintained by Migration' },
        { file: 'design-b.md', line: 1, excerpt: 'assigned by Clinical Design at go-live' },
      ],
    };

    assert.equal(checkSeverityFloor(corpus, entry).raised, false);
    const out = applySeverityFloor(corpus, entry);
    assert.equal(out.proposed_severity, 'Considerable');
    assert.equal(out.severity_rationale, 'Model rationale here.');
    assert.equal('severity_raised' in out, false);
  });

  test('explicit Unknown severity exists, but on a non-clinical, cosmetic field: not raised', () => {
    const corpus = synthCorpus({
      'design-a.md': [
        'Where no display colour can be parsed the record is migrated with severity set to "Unknown" and remains active and visible in the theme settings panel.',
      ],
    });
    const entry = {
      hazard_name: 'Theme colour defaults to Unknown',
      hazard_description: 'Cosmetic theme preference is Unknown after migration; no clinical impact.',
      causes: [],
      proposed_severity: 'Minor',
      evidence: [{ file: 'design-a.md', line: 1, excerpt: 'severity set to "Unknown"' }],
    };
    assert.equal(checkSeverityFloor(corpus, entry).raised, false, 'no clinical/prescribing panel is mentioned');
    assert.equal(applySeverityFloor(corpus, entry).proposed_severity, 'Minor');
  });

  test('"severity Unknown" language present but negated: not raised', () => {
    const corpus = synthCorpus({
      'design-a.md': ['The record is active and visible in the clinical panel; severity is not Unknown, it is always derived before go-live.'],
    });
    const entry = {
      hazard_name: 'Panel visibility',
      hazard_description: 'clinical panel visibility question',
      causes: [],
      proposed_severity: 'Significant',
      evidence: [{ file: 'design-a.md', line: 1, excerpt: 'active and visible in the clinical panel' }],
    };
    assert.equal(checkSeverityFloor(corpus, entry).raised, false);
  });

  test('the condition holds, but the model already proposed Major or above: left unchanged, no spurious note', () => {
    const corpus = synthCorpus({
      'design-a.md': ['severity set to "Unknown" and remains active and visible in the clinical panel'],
    });
    for (const already of ['Major', 'Catastrophic']) {
      const entry = {
        hazard_name: 'Panel visibility',
        hazard_description: 'clinical panel visibility conflict',
        causes: [],
        proposed_severity: already,
        severity_rationale: 'Original rationale.',
        evidence: [{ file: 'design-a.md', line: 1, excerpt: 'severity set to "Unknown"' }],
      };
      const out = applySeverityFloor(corpus, entry);
      assert.equal(out.proposed_severity, already);
      assert.equal(out.severity_rationale, 'Original rationale.');
      assert.equal('severity_raised' in out, false, `${already} should not be reported as raised`);
    }
  });

  test('the rule only inspects documents this hazard\'s own evidence already cites, not the whole corpus', () => {
    const corpus = synthCorpus({
      'design-a.md': ['Ward codes come from a lookup table.'],
      'unrelated.md': ['severity set to "Unknown" and remains active and visible in the clinical panel'],
    });
    const entry = {
      hazard_name: 'Ward code panel dependency',
      hazard_description: 'A clinical panel depends on an undefined ward code lookup.',
      causes: [],
      proposed_severity: 'Significant',
      evidence: [{ file: 'design-a.md', line: 1, excerpt: 'Ward codes come from a lookup table.' }],
    };
    assert.equal(checkSeverityFloor(corpus, entry).raised, false, 'unrelated.md is never cited by this hazard, so it must not be searched');
  });
});

/**
 * The detection gap the README flags: the floor can raise severity from
 * corpus text alone while the model's own `causes` never explain why. These
 * tests pin `cited_requirements` and the honest `severity_floor_citation_gap`
 * flag that reports the gap instead of papering over it - see src/risk.ts,
 * `checkFloorCitation` / `requirementIdAt`.
 */
describe('checkFloorCitation / requirementIdAt: does the model\'s own citation name the requirement that triggered the floor?', () => {
  const corpus = synthCorpus({
    'design-a.md': [
      '### SYS-01-R09: Severity Default on Parse Failure',
      'Where no severity can be parsed the record is migrated with severity set to "Unknown" and remains active and visible in the clinical prescribing panel.',
    ],
    'design-b.md': [
      'The clinical panel shall be empty at go-live for all migrated patients.',
    ],
  });

  test('requirementIdAt reads the heading directly above the triggering line', () => {
    assert.equal(requirementIdAt(corpus, 'design-a.md', 2), 'SYS-01-R09');
    assert.equal(requirementIdAt(corpus, 'design-a.md', 1), 'SYS-01-R09', 'the heading line itself also carries its id inline');
    assert.equal(requirementIdAt(corpus, 'design-b.md', 1), undefined, 'no heading above this line and no id inline');
  });

  test('checkFloorCitation: gap reported when the model never cites the triggering requirement', () => {
    const entry = {
      hazard_name: 'Conflicting panel visibility',
      hazard_description: 'desc mentions clinical panel',
      causes: ['some prose that never names SYS-01-R09'],
      cited_requirements: ['SOME-OTHER-ID'],
      proposed_severity: 'Considerable',
      evidence: [
        { file: 'design-a.md', line: 2, excerpt: 'severity set to "Unknown" and remains active and visible' },
        { file: 'design-b.md', line: 1, excerpt: 'The clinical panel shall be empty at go-live' },
      ],
    };
    const check = checkSeverityFloor(corpus, entry);
    assert.equal(check.raised, true);
    const citation = checkFloorCitation(corpus, check, entry.cited_requirements);
    assert.equal(citation.checked, true);
    assert.equal(citation.gap, true);
    assert.equal(citation.requirementId, 'SYS-01-R09');
  });

  test('checkFloorCitation: no gap when the model does cite the triggering requirement (case-insensitive)', () => {
    const entry = {
      hazard_name: 'Conflicting panel visibility',
      hazard_description: 'desc mentions clinical panel',
      causes: ['SYS-01-R09 defaults unparsed severity to Unknown'],
      cited_requirements: ['sys-01-r09'],
      proposed_severity: 'Considerable',
      evidence: [
        { file: 'design-a.md', line: 2, excerpt: 'severity set to "Unknown" and remains active and visible' },
        { file: 'design-b.md', line: 1, excerpt: 'The clinical panel shall be empty at go-live' },
      ],
    };
    const check = checkSeverityFloor(corpus, entry);
    const citation = checkFloorCitation(corpus, check, entry.cited_requirements);
    assert.equal(citation.checked, true);
    assert.equal(citation.gap, false);
  });

  test('applySeverityFloor: model cites the triggering requirement -> raised, no citation gap flagged', () => {
    const entry = {
      hazard_name: 'Conflicting panel visibility',
      hazard_description: 'desc mentions clinical panel',
      causes: ['SYS-01-R09 defaults unparsed severity to Unknown and keeps it active'],
      cited_requirements: ['SYS-01-R09'],
      proposed_severity: 'Considerable',
      evidence: [
        { file: 'design-a.md', line: 2, excerpt: 'severity set to "Unknown" and remains active and visible' },
        { file: 'design-b.md', line: 1, excerpt: 'The clinical panel shall be empty at go-live' },
      ],
    };
    const out = applySeverityFloor(corpus, entry);
    assert.equal(out.proposed_severity, 'Major');
    assert.equal(out.severity_raised, true);
    assert.equal('severity_floor_citation_gap' in out, false, 'the model already named the requirement, so there is nothing to flag');
    assert.deepEqual(out.severity_raised_source, { file: 'design-a.md', line: 2 });
  });

  test('applySeverityFloor: model never cites the triggering requirement -> raised AND flagged, causes/cited_requirements left untouched', () => {
    const entry = {
      hazard_name: 'Conflicting panel visibility',
      hazard_description: 'desc mentions clinical panel',
      causes: ['One design keeps the panel populated, the other keeps it empty.'],
      cited_requirements: [] as string[],
      proposed_severity: 'Considerable',
      evidence: [
        { file: 'design-a.md', line: 2, excerpt: 'severity set to "Unknown" and remains active and visible' },
        { file: 'design-b.md', line: 1, excerpt: 'The clinical panel shall be empty at go-live' },
      ],
    };
    const out = applySeverityFloor(corpus, entry);
    assert.equal(out.proposed_severity, 'Major', 'the floor still raises the severity even though the model never connected it');
    assert.equal(out.severity_floor_citation_gap, true);
    assert.equal(out.severity_floor_missing_requirement_id, 'SYS-01-R09');
    assert.deepEqual(out.causes, ['One design keeps the panel populated, the other keeps it empty.'], 'nothing is injected into causes on the model\'s behalf');
    assert.deepEqual(out.cited_requirements, [], 'nothing is injected into cited_requirements on the model\'s behalf');
  });

  test('checkFloorCitation: checked is false when the floor did not fire, or no requirement id can be resolved for the triggering line', () => {
    assert.deepEqual(checkFloorCitation(corpus, { raised: false }, ['anything']), { checked: false, gap: false });
    const noHeadingCorpus = synthCorpus({
      'design-c.md': ['severity set to "Unknown" and remains active and visible in the clinical panel, no heading above this line'],
    });
    const check = checkSeverityFloor(noHeadingCorpus, {
      hazard_name: 'x', hazard_description: 'clinical panel', causes: [],
      evidence: [{ file: 'design-c.md', line: 1, excerpt: 'severity set to "Unknown"' }],
    });
    assert.equal(check.raised, true);
    const citation = checkFloorCitation(noHeadingCorpus, check, []);
    assert.equal(citation.checked, false, 'no id could be resolved for the triggering line, so no gap is reported either way');
    assert.equal(citation.gap, false);
  });
});

describe('the same rule against the real corpus: HZ-001 (DM-04-R05, the panel-visibility contradiction)', () => {
  const corpus = loadCorpus('corpus');

  test('DM-04-R05 (FLLD-DM-v3.md:32) plus the CLIN-11 panel requirement raises Considerable to Major', () => {
    const entry = {
      hazard_name: 'Conflicting Allergy Data Visibility',
      hazard_description: 'Conflicting requirements exist regarding the visibility of legacy allergy data in the Aurora clinical summary panel.',
      causes: [],
      proposed_severity: 'Considerable',
      evidence: [
        { file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'shall be unpopulated and empty at go-live for all migrated patients' },
        { file: 'FLLD-DM-v3.md', line: 26, excerpt: 'shall be rendered immediately visible and active in the Aurora Allergy' },
      ],
    };
    const check = checkSeverityFloor(corpus, entry);
    assert.equal(check.raised, true);
    assert.deepEqual(check.source, { file: 'FLLD-DM-v3.md', line: 32 });
    assert.equal(applySeverityFloor(corpus, entry).proposed_severity, 'Major');
    assert.ok(severityScore(SEVERITY_FLOOR_LEVEL) >= severityScore('Considerable'));
  });

  test('the exact gap the README describes: the 12B run\'s own causes for HZ-001 never mention DM-04-R05 - the floor still raises severity, and the entry is now honestly flagged rather than silent', () => {
    // These are the archived gemma3:12b run's actual causes and cited_requirements for HZ-001
    // (docs/runs/gemma3-12b/hazard-log.json, before this fix added the field): the model explains
    // the panel-visibility contradiction via CLIN-11-R01/R02/DM-04-R03, and never once names
    // DM-04-R05, the "severity Unknown" requirement the floor actually fires on.
    const entry = {
      hazard_name: 'Conflicting Allergy Data Visibility',
      hazard_description: 'Conflicting requirements exist regarding the visibility of legacy allergy data in the Aurora clinical summary panel.',
      causes: [
        'CLIN-11-R01 states legacy allergy data should be unpopulated at go-live.',
        'CLIN-11-R02 states legacy allergy data must never populate a clinical field.',
        'DM-04-R03 states migrated allergy records *will* be visible in the panel at go-live.',
      ],
      cited_requirements: ['CLIN-11-R01', 'CLIN-11-R02', 'DM-04-R03'],
      proposed_severity: 'Considerable',
      evidence: [
        { file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'shall be unpopulated and empty at go-live for all migrated patients' },
        { file: 'FLLD-DM-v3.md', line: 26, excerpt: 'shall be rendered immediately visible and active in the Aurora Allergy' },
      ],
    };
    const out = applySeverityFloor(corpus, entry);
    assert.equal(out.proposed_severity, 'Major', 'the floor fires from corpus text alone, whether or not the model connected it');
    assert.equal(out.severity_floor_citation_gap, true, 'the model cited three requirements but never the one the floor actually depends on');
    assert.equal(out.severity_floor_missing_requirement_id, 'DM-04-R05');
    assert.deepEqual(out.cited_requirements, ['CLIN-11-R01', 'CLIN-11-R02', 'DM-04-R03'], 'nothing is injected on the model\'s behalf');
  });

  test('when the model does cite DM-04-R05 for the same hazard, no citation gap is reported', () => {
    const entry = {
      hazard_name: 'Conflicting Allergy Data Visibility',
      hazard_description: 'Conflicting requirements exist regarding the visibility of legacy allergy data in the Aurora clinical summary panel.',
      causes: ['DM-04-R05 defaults unparsed severity to Unknown and keeps the record active and visible on the panel.'],
      cited_requirements: ['DM-04-R05'],
      proposed_severity: 'Considerable',
      evidence: [
        { file: 'FLLD-CLIN-v2.md', line: 16, excerpt: 'shall be unpopulated and empty at go-live for all migrated patients' },
        { file: 'FLLD-DM-v3.md', line: 26, excerpt: 'shall be rendered immediately visible and active in the Aurora Allergy' },
      ],
    };
    const out = applySeverityFloor(corpus, entry);
    assert.equal(out.proposed_severity, 'Major');
    assert.equal('severity_floor_citation_gap' in out, false);
  });

  test('HZ-003-style hazard (severity DERIVATION disputed in chat, no explicit Unknown-on-panel evidence): not raised', () => {
    const entry = {
      hazard_name: 'Approved design and build artefacts disagree on severity derivation',
      hazard_description: 'Severity derivation was cancelled verbally and in the mapping sheet on 3 March. The approved design still mandates it.',
      causes: ['Decision taken in a Teams channel, not propagated to the approved artefact'],
      proposed_severity: 'Considerable',
      evidence: [
        { file: 'teams-export.txt', line: 2, excerpt: "We can't derive severity from free text, it's a prescribing risk." },
        { file: 'FLLD-DM-v3.md', line: 29, excerpt: 'shall be algorithmically inferred from legacy free-text clinical notes' },
      ],
    };
    assert.equal(checkSeverityFloor(corpus, entry).raised, false, 'this hazard is about derivation, not a declared Unknown left live on a panel, and never mentions a panel');
    assert.equal(applySeverityFloor(corpus, entry).proposed_severity, 'Considerable');
  });
});
