/** Deterministic risk arithmetic. The model proposes a severity and a likelihood; the rating is never model-asserted. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Corpus } from './corpus.ts';

type Scale = { score: number; level: string; definition: string };
export type RiskMatrix = {
  severity: Scale[];
  likelihood: Scale[];
  matrix_rows_likelihood_cols_severity: Record<string, number[]>;
  acceptability: Record<string, string>;
};

export const MATRIX: RiskMatrix = JSON.parse(
  readFileSync(fileURLToPath(new URL('../shared/risk-matrix.json', import.meta.url)), 'utf8'),
);

export function severityScore(level: string): number {
  const s = MATRIX.severity.find((x) => x.level.toLowerCase() === level.toLowerCase());
  if (!s) throw new Error(`unknown severity level: ${level}`);
  return s.score;
}
export function likelihoodScore(level: string): number {
  const l = MATRIX.likelihood.find((x) => x.level.toLowerCase() === level.toLowerCase());
  if (!l) throw new Error(`unknown likelihood level: ${level}`);
  return l.score;
}
export function riskRating(severity: string, likelihood: string): { rating: number; acceptability: string } {
  const s = severityScore(severity);
  const l = likelihoodScore(likelihood);
  const rating = MATRIX.matrix_rows_likelihood_cols_severity[String(l)][s - 1];
  return { rating, acceptability: MATRIX.acceptability[String(rating)] };
}

/**
 * A severity floor for one specific, narrow situation: a contradiction where
 * one side has not merely omitted its severity but has explicitly declared
 * it "Unknown" in an approved document, on a field the same document keeps
 * active, visible or live on a clinical (or prescribing) panel.
 *
 * DCB0160 4.4.1 asks for an estimate of severity, not an average of what the
 * two conflicting documents each assert. An unresolved "Unknown" on a live
 * prescribing panel is not one input to be blended with the other side's
 * claim - it is itself the aggravating fact, because it means nobody has
 * verified the thing a clinician is about to trust. A model that scores the
 * contradiction as if "Unknown" were just another value on the severity
 * scale will underscore it. This is what the archived gemma3:12b and 4B live
 * runs under docs/runs/ both did (see README, "Live runs").
 *
 * This is a floor, not a rewrite: it only ever raises proposed_severity, and
 * only when both conditions hold, checked against the corpus text at the
 * evidence's own verified file:line - never against the model's paraphrase,
 * so a differently-worded restatement can't talk the rule out of firing.
 */
export const SEVERITY_FLOOR_LEVEL = 'Major';

// "severity ... Unknown" close together, with no negation in between (rules out "severity is not Unknown").
const EXPLICIT_UNKNOWN_SEVERITY = /\bseverity\b(?:(?!\b(?:not|never|isn'?t|is\s+not)\b)[^\n]){0,40}\bunknown\b/i;
// The field this "Unknown" severity sits in is live, i.e. still shown to a clinician, not quarantined.
const LIVE_OR_ACTIVE_FIELD = /\b(active|visible|live)\b/i;
// The hazard is about a clinical or prescribing panel, not a cosmetic or non-clinical field.
const CLINICAL_OR_PRESCRIBING_PANEL = /\b(clinical|prescrib\w*)\b[^.\n]{0,60}\bpanel\b|\bpanel\b[^.\n]{0,60}\b(clinical|prescrib\w*)\b/i;

export type SeverityFloorEntry = {
  hazard_name: string;
  hazard_description: string;
  causes: string[];
  evidence: { file: string; line: number; excerpt?: string }[];
};
export type SeverityFloorCheck = { raised: boolean; because?: string; source?: { file: string; line: number } };

/**
 * Does this hazard qualify for the floor? Two independent gates, both
 * required: (1) the hazard itself, including its own cited evidence, is
 * about a clinical/prescribing panel, not a cosmetic field; (2) among the
 * documents that hazard's evidence already cites, some line explicitly
 * declares its own severity "Unknown" while keeping that field active,
 * visible or live. The corpus line is read fresh from `corpus`, not taken on
 * the model's word.
 */
export function checkSeverityFloor(corpus: Corpus, entry: SeverityFloorEntry): SeverityFloorCheck {
  const subject = [entry.hazard_name, entry.hazard_description, ...(entry.causes ?? []), ...entry.evidence.map((e) => e.excerpt ?? '')].join('\n');
  if (!CLINICAL_OR_PRESCRIBING_PANEL.test(subject)) return { raised: false };

  const evidenceFiles = new Set(entry.evidence.map((e) => e.file));
  for (const f of corpus.files) {
    if (!evidenceFiles.has(f.file)) continue;
    for (let i = 0; i < f.lines.length; i++) {
      const text = f.lines[i];
      if (EXPLICIT_UNKNOWN_SEVERITY.test(text) && LIVE_OR_ACTIVE_FIELD.test(text)) {
        return {
          raised: true,
          source: { file: f.file, line: i + 1 },
          because: `${f.file}:${i + 1} explicitly declares its own severity "Unknown" on a field that stays active/visible on a live clinical panel, and this hazard's own evidence already cites that document`,
        };
      }
    }
  }
  return { raised: false };
}

/**
 * Apply the floor. Never lowers a severity the model proposed; never invents
 * a reason when the floor did not fire. When it does fire and raises the
 * severity, the reason is prepended to severity_rationale so it travels with
 * the hazard log entry the CSO reviews, and severity_raised* fields record
 * it structurally for anything that wants to check without parsing prose.
 */
export function applySeverityFloor<T extends SeverityFloorEntry & { proposed_severity: string; severity_rationale?: string }>(
  corpus: Corpus,
  entry: T,
): T & { severity_raised?: true; severity_raised_from?: string; severity_raised_reason?: string } {
  const check = checkSeverityFloor(corpus, entry);
  if (!check.raised) return entry;
  if (severityScore(entry.proposed_severity) >= severityScore(SEVERITY_FLOOR_LEVEL)) return entry;

  const from = entry.proposed_severity;
  const reason = `Raised from ${from} to ${SEVERITY_FLOOR_LEVEL}: unverified severity on a live prescribing panel is not merely one input, it is the hazard (${check.because}).`;
  return {
    ...entry,
    proposed_severity: SEVERITY_FLOOR_LEVEL,
    severity_rationale: entry.severity_rationale ? `${reason} ${entry.severity_rationale}` : reason,
    severity_raised: true,
    severity_raised_from: from,
    severity_raised_reason: reason,
  };
}
