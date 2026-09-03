/** Deterministic risk arithmetic. The model proposes a severity and a likelihood; the rating is never model-asserted. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
