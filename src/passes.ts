/**
 * The three model passes, all local. Each is schema-constrained, and every
 * citation the model returns is checked against the corpus in code before it
 * is kept. A finding or hazard entry with any unverifiable source is dropped
 * and recorded under `dropped`, never surfaced.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCorpus, prefixedCorpus, verifyCitation, type Corpus, type Citation } from './corpus.ts';
import { buildIndex, type Index } from './prepass.ts';
import { generateJson, type OllamaOptions } from './ollama.ts';
import { riskRating } from './risk.ts';

const SCHEMAS = JSON.parse(readFileSync(fileURLToPath(new URL('../shared/schema.json', import.meta.url)), 'utf8'));

export type Source = Citation & { verified?: boolean };
export type Requirement = { id: string; statement: string; file: string; line: number; excerpt: string; author: string; date: string; status: string; workstream: string };
export type Finding = { id: string; type: string; title: string; why_incompatible: string; clinical_consequence: string; sources: Source[] };
export type HazardEntry = {
  hazard_id: string; finding_id: string; hazard_name: string; hazard_description: string; causes: string[];
  clinical_effect: string; existing_controls: string[]; proposed_severity: string; severity_rationale?: string;
  proposed_likelihood: string; likelihood_rationale?: string; proposed_controls: string[]; proposed_owner_role: string;
  evidence: Source[]; standard_refs: string[];
};
export type Dropped = { pass: 1 | 2 | 3; id: string; reason: string; item: unknown };

const SYSTEM = `You are HAZLOG, a clinical safety analyst working inside an NHS trust's clinical risk management process (DCB0160).
You read a corpus of programme artefacts. Every line is prefixed FILE:LINE| . When you cite, you MUST give the exact FILE, the exact LINE, and an excerpt copied verbatim from that line (12 characters or more, no paraphrase). A citation that does not resolve will be discarded in code and the finding with it, so cite only what is really there.
Be specific, be short, and never invent requirements, people or documents that are not in the corpus.`;

export function pass1Prompt(corpus: Corpus, index: Index): string {
  const ids = index.requirement_ids.filter((r) => r.heading).map((r) => `${r.id} (${r.file}:${r.line})`).join(', ');
  return `PASS 1 - EXTRACTION.
Extract every atomic requirement, decision or constraint from the corpus. Treat formal requirement statements, spreadsheet rows and chat messages as equally first-class.
Known requirement headings from the deterministic index: ${ids}. The requirement text is normally on the line after its heading; cite the text line.
For each item give: id (use the document's own id, or MAP-ROW-nn for a CSV row, or CHAT-nn for a chat message), a one-sentence statement, file, line, a verbatim excerpt from that line, author, date, status (APPROVED for signed designs, DRAFT for the mapping sheet, VERBAL for a chat statement, UNRECORDED for a decision that reached no document) and workstream.

CORPUS:
${prefixedCorpus(corpus)}`;
}

export function pass2Prompt(corpus: Corpus, requirements: Requirement[]): string {
  return `PASS 2 - HAZARD DETECTION.
Using the verified requirements below and the full corpus, find every place where two or more artefacts cannot both be true, or where a decision has no authoritative source or no owner. Types:
- CONTRADICTION: two approved requirements that cannot both be satisfied
- SILENT_DEFAULT: a fallback or default value that asserts a clinical fact
- VERBAL_OVERRIDE: a decision made in chat or a sheet that an approved document still contradicts
- ORPHAN_DEPENDENCY: a build artefact that depends on a design that does not exist
- UNOWNED_DECISION: a question raised and not owned by anyone
Every finding MUST cite at least two sources from at least two different files, each with file, line and a verbatim excerpt. Describe the clinical consequence for a patient, not the project consequence.

VERIFIED REQUIREMENTS:
${JSON.stringify(requirements, null, 1)}

CORPUS:
${prefixedCorpus(corpus)}`;
}

export function pass3Prompt(corpus: Corpus, findings: Finding[]): string {
  return `PASS 3 - HAZARD LOG ENTRY.
For each finding, draft a DCB0160 hazard log entry. Give hazard_name, hazard_description, causes, clinical_effect, existing_controls (from the corpus; say "None recorded" if none), proposed_severity (Minor, Significant, Considerable, Major, Catastrophic), a one-sentence severity_rationale, proposed_likelihood (Very low, Low, Medium, High, Very high), a one-sentence likelihood_rationale, proposed_controls, proposed_owner_role (a role named in the corpus, or UNASSIGNED with a proposal), and evidence: at least two citations with file, line and verbatim excerpt.
You are proposing. A Clinical Safety Officer confirms severity and likelihood; you do not.

FINDINGS:
${JSON.stringify(findings, null, 1)}

CORPUS:
${prefixedCorpus(corpus)}`;
}

function verifyAll(corpus: Corpus, cites: Citation[]): { ok: boolean; sources: Source[]; reason?: string } {
  const sources: Source[] = [];
  for (const c of cites) {
    const v = verifyCitation(corpus, c);
    sources.push({ ...c, verified: v.verified });
    if (!v.verified) return { ok: false, sources, reason: `${c.file}:${c.line}: ${v.reason}` };
  }
  const files = new Set(cites.map((c) => c.file));
  if (cites.length < 2) return { ok: false, sources, reason: 'fewer than two sources' };
  if (files.size < 2) return { ok: false, sources, reason: 'all sources are in one file; a hazard between documents needs two documents' };
  return { ok: true, sources };
}

export async function runPipeline(corpusDir: string, opts: OllamaOptions & { log?: (s: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const corpus = loadCorpus(corpusDir);
  const index = buildIndex(corpus);
  const dropped: Dropped[] = [];
  const t0 = Date.now();

  log('pass 1: extraction');
  const p1 = await generateJson<{ requirements: Requirement[] }>(SYSTEM, pass1Prompt(corpus, index), SCHEMAS.pass1_requirements, opts);
  const requirements: Requirement[] = [];
  for (const r of p1.requirements ?? []) {
    const v = verifyCitation(corpus, { file: r.file, line: r.line, excerpt: r.excerpt });
    if (v.verified) requirements.push(r);
    else dropped.push({ pass: 1, id: r.id, reason: `${r.file}:${r.line}: ${v.reason}`, item: r });
  }
  log(`  ${requirements.length} requirements verified, ${p1.requirements.length - requirements.length} dropped`);

  log('pass 2: hazard detection');
  const p2 = await generateJson<{ findings: Finding[] }>(SYSTEM, pass2Prompt(corpus, requirements), SCHEMAS.pass2_findings, opts);
  const findings: Finding[] = [];
  (p2.findings ?? []).forEach((f, i) => {
    const v = verifyAll(corpus, f.sources ?? []);
    if (v.ok) findings.push({ ...f, id: `F-${String(findings.length + 1).padStart(2, '0')}`, sources: v.sources });
    else dropped.push({ pass: 2, id: f.id ?? `candidate-${i + 1}`, reason: v.reason!, item: { ...f, sources: v.sources } });
  });
  log(`  ${findings.length} findings verified, ${(p2.findings ?? []).length - findings.length} dropped`);

  log('pass 3: hazard log entries');
  const entries: HazardEntry[] = [];
  if (findings.length) {
    const p3 = await generateJson<{ entries: Omit<HazardEntry, 'hazard_id' | 'standard_refs'>[] }>(SYSTEM, pass3Prompt(corpus, findings), SCHEMAS.pass3_hazard_entries, opts);
    for (const e of p3.entries ?? []) {
      const v = verifyAll(corpus, e.evidence ?? []);
      if (!findings.some((f) => f.id === e.finding_id)) { dropped.push({ pass: 3, id: e.finding_id, reason: 'refers to a finding that was not verified', item: e }); continue; }
      if (!v.ok) { dropped.push({ pass: 3, id: e.finding_id, reason: v.reason!, item: { ...e, evidence: v.sources } }); continue; }
      try { riskRating(e.proposed_severity, e.proposed_likelihood); } catch (err) { dropped.push({ pass: 3, id: e.finding_id, reason: (err as Error).message, item: e }); continue; }
      entries.push({
        ...e,
        hazard_id: `HZ-${String(entries.length + 1).padStart(3, '0')}`,
        evidence: v.sources,
        standard_refs: ['DCB0160 4.3.1 identify hazards in normal and fault conditions', 'DCB0160 4.4.1 estimate severity, likelihood and clinical risk', 'DCB0160 3.3.2 CSO approves each version of the Hazard Log'],
      });
    }
    log(`  ${entries.length} hazard entries verified, ${(p3.entries ?? []).length - entries.length} dropped`);
  }

  const run = { engine: 'GEMMA_LOCAL', model: opts.model ?? process.env.HAZLOG_MODEL ?? 'gemma3', timestamp: new Date().toISOString(), execution_ms: Date.now() - t0, corpus_files: corpus.files.map((f) => f.file) };
  return {
    findings: { run, requirements, findings, dropped },
    hazardLog: {
      run: { ...run, note: 'Severity and likelihood are proposals. Nothing here is a confirmed hazard log entry until a Clinical Safety Officer signs it (DCB0160 3.3.2).', standard: { id: 'DCB0160', amendment: 'Amd 25/2018', version: '3.2', published: '7 June 2018', legal_basis: 'Section 250, Health and Social Care Act 2012' } },
      entries,
    },
    index,
  };
}
