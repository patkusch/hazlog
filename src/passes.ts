/**
 * The three model passes, all local. Each is schema-constrained, and every
 * citation the model returns is checked against the corpus in code before it
 * is kept. A finding or hazard entry with any unverifiable source is dropped
 * and recorded under `dropped`, never surfaced.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCorpus, prefixedCorpus, resolveCitation, getLine, type Corpus, type Citation } from './corpus.ts';
import { buildIndex, type Index } from './prepass.ts';
import { generateJson, type OllamaOptions } from './ollama.ts';
import { riskRating, applySeverityFloor } from './risk.ts';

const SCHEMAS = JSON.parse(readFileSync(fileURLToPath(new URL('../shared/schema.json', import.meta.url)), 'utf8'));

export type Source = Citation & { verified?: boolean; repaired?: boolean; cited_as?: { file: string; line: number } };
export type Requirement = { id: string; statement: string; file: string; line: number; excerpt: string; author: string; date: string; status: string; workstream: string; repaired?: boolean; cited_as?: { file: string; line: number }; id_cited_as?: string; source?: 'model' | 'pass0' };
export type Finding = { id: string; type: string; title: string; why_incompatible: string; clinical_consequence: string; sources: Source[] };
export type HazardEntry = {
  hazard_id: string; finding_id: string; hazard_name: string; hazard_description: string; causes: string[];
  cited_requirements: string[];
  clinical_effect: string; existing_controls: string[]; proposed_severity: string; severity_rationale?: string;
  proposed_likelihood: string; likelihood_rationale?: string; proposed_controls: string[]; proposed_owner_role: string;
  evidence: Source[]; standard_refs: string[];
  severity_raised?: true; severity_raised_from?: string; severity_raised_reason?: string; severity_raised_source?: { file: string; line: number };
  severity_floor_citation_gap?: true; severity_floor_missing_requirement_id?: string;
};
export type Dropped = { pass: 1 | 2 | 3; id: string; reason: string; item: unknown };

const SYSTEM = `You are HAZLOG, a clinical safety analyst working inside an NHS trust's clinical risk management process (DCB0160).
You read a corpus of programme artefacts. Every line is prefixed FILE:LINE| . When you cite, you MUST give the exact FILE, the exact LINE, and an excerpt copied verbatim from that line (12 characters or more, no paraphrase). A citation that does not resolve will be discarded in code and the finding with it, so cite only what is really there.
Be specific, be short, and never invent requirements, people or documents that are not in the corpus.`;

export function pass1Prompt(corpus: Corpus, index: Index): string {
  const ids = index.requirement_ids.filter((r) => r.heading).map((r) => `${r.id} (${r.file}:${r.line})`).join(', ');
  return `PASS 1 - EXTRACTION.
Extract every atomic requirement from the DESIGN DOCUMENTS (.md files) in the corpus. The mapping sheet (.csv) and the chat export (.txt) are indexed deterministically and handed to the next pass line by line; do not extract from them here.
Copy the excerpt verbatim from a single line. The FILE and LINE you give are checked in code and, if wrong, corrected from the excerpt; an excerpt that is not in the corpus is discarded.
Known requirement headings from the deterministic index: ${ids}. The requirement text is normally on the line after its heading; cite the text line.
For each item give: id (the document's own id, e.g. DM-04-R05), a one-sentence statement, file, line, a verbatim excerpt from that line, author, date, status (APPROVED for signed designs) and workstream.

CORPUS:
${prefixedCorpus(corpus)}`;
}

export function pass2Prompt(corpus: Corpus, requirements: Requirement[], seeded: Requirement[] = []): string {
  return `PASS 2 - HAZARD DETECTION.
Using the verified requirements below and the full corpus, find every place where two or more artefacts cannot both be true, or where a decision has no authoritative source or no owner. Types:
- CONTRADICTION: two approved requirements that cannot both be satisfied
- SILENT_DEFAULT: a fallback or default value that asserts a clinical fact
- VERBAL_OVERRIDE: a decision made in chat or a sheet that an approved document still contradicts
- ORPHAN_DEPENDENCY: a build artefact that depends on a design that does not exist
- UNOWNED_DECISION: a question raised and not owned by anyone
Every finding MUST cite at least two sources, each with file, line and an excerpt copied verbatim from that one line. A CONTRADICTION, SILENT_DEFAULT, VERBAL_OVERRIDE or ORPHAN_DEPENDENCY MUST cite two DIFFERENT FILES; an UNOWNED_DECISION may cite two lines of one file. Two requirements in the same document that agree with each other are not a finding. Copy the excerpt exactly; the file and line are checked in code and corrected from the excerpt if wrong. Describe the clinical consequence for a patient, not the project consequence.

VERIFIED DESIGN REQUIREMENTS (extracted from the design documents, provenance checked):
${JSON.stringify(requirements.map(({ id, statement, file, line, excerpt, author, date, status }) => ({ id, statement, file, line, excerpt, author, date, status })), null, 1)}

MAPPING SHEET ROWS AND CHAT MESSAGES (indexed deterministically; file and line are exact):
${JSON.stringify(seeded.map(({ id, statement, file, line, author, date, status }) => ({ id, statement, file, line, author, date, status })), null, 1)}

CORPUS:
${prefixedCorpus(corpus)}`;
}

export function pass3Prompt(corpus: Corpus, findings: Finding[]): string {
  return `PASS 3 - HAZARD LOG ENTRY.
For each finding, draft a DCB0160 hazard log entry. Give hazard_name, hazard_description, causes, clinical_effect, existing_controls (from the corpus; say "None recorded" if none), proposed_severity (Minor, Significant, Considerable, Major, Catastrophic), a one-sentence severity_rationale, proposed_likelihood (Very low, Low, Medium, High, Very high), a one-sentence likelihood_rationale, proposed_controls, proposed_owner_role (a role named in the corpus, or UNASSIGNED with a proposal), and evidence: at least two citations from two different files, each with file, line and an excerpt copied verbatim from that one line (reuse the finding's sources where they fit).
Also give cited_requirements: the exact requirement id(s) (e.g. "DM-04-R05", "CLIN-11-R01") that your causes explanation is actually based on - not every id mentioned anywhere, only the ones a reader would need to check to see whether your causes are right. Each cause in causes should be traceable to a specific requirement, row or message id from the corpus; do not write causes in prose alone and leave the reader to guess which line backs it. If a cause comes from the chat export or mapping sheet rather than a formal requirement heading, cite the id the corpus itself gives that row or message (e.g. "CHAT-03", "MAP-ROW-12") if there is one, or omit it from cited_requirements rather than inventing one.
You are proposing. A Clinical Safety Officer confirms severity and likelihood; you do not.

FINDINGS:
${JSON.stringify(findings, null, 1)}

CORPUS:
${prefixedCorpus(corpus)}`;
}

/** A contradiction, a silent default, a verbal override or an orphan dependency is a relationship between documents and must cite two. An unowned decision is a gap: it can live entirely in one channel, so it needs two lines, not two files. */
export const TWO_FILE_TYPES = new Set(['CONTRADICTION', 'SILENT_DEFAULT', 'VERBAL_OVERRIDE', 'ORPHAN_DEPENDENCY']);

function verifyAll(corpus: Corpus, cites: Citation[], type = 'CONTRADICTION'): { ok: boolean; sources: Source[]; reason?: string } {
  const sources: Source[] = [];
  for (const c of cites) {
    const v = resolveCitation(corpus, c);
    sources.push({ ...c, file: v.file, line: v.line, verified: v.verified, ...(v.repaired ? { repaired: true, cited_as: v.cited_as } : {}) });
    if (!v.verified) return { ok: false, sources, reason: `${c.file}:${c.line}: ${v.reason}` };
  }
  const files = new Set(sources.map((c) => c.file));
  if (sources.length < 2) return { ok: false, sources, reason: 'fewer than two sources' };
  if (TWO_FILE_TYPES.has(type) && files.size < 2) return { ok: false, sources, reason: `all sources are in one file; a ${type} is a relationship between documents and needs two` };
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
    const v = resolveCitation(corpus, { file: r.file, line: r.line, excerpt: r.excerpt });
    if (!v.verified) { dropped.push({ pass: 1, id: r.id, reason: `${r.file}:${r.line}: ${v.reason}`, item: r }); continue; }
    const out: Requirement = { ...r, file: v.file, line: v.line, source: 'model', ...(v.repaired ? { repaired: true, cited_as: v.cited_as } : {}) };
    // The line above a requirement's text is its heading in the design documents; the index knows the heading's id.
    const heading = index.requirement_ids.find((h) => h.heading && h.file === v.file && h.line === v.line - 1);
    if (heading && heading.id !== r.id) { out.id_cited_as = r.id; out.id = heading.id; }
    if (requirements.some((x) => x.file === out.file && x.line === out.line)) continue;
    requirements.push(out);
  }
  const repaired1 = requirements.filter((r) => r.repaired).length;
  log(`  ${requirements.length} requirements verified (${repaired1} with the citation corrected from the excerpt), ${(p1.requirements ?? []).length - requirements.length} dropped`);

  // Sheet rows and chat messages come from Pass 0 with exact addresses; no model in the loop.
  const seeded: Requirement[] = [];
  for (const row of index.csv_rows) {
    const text = getLine(corpus, row.file, row.line) ?? '';
    seeded.push({ id: `MAP-ROW-${String(row.Row).padStart(2, '0')}`, statement: `${row.Legacy_Field} -> ${row.Aurora_Field} | Migrate=${row.Migrate} | ${row.Transform}`, file: row.file, line: row.line, excerpt: text, author: row.Owner ?? '', date: row.Last_Changed ?? '', status: 'DRAFT', workstream: 'Data Migration (mapping sheet)', source: 'pass0' });
  }
  index.chat_messages.forEach((m, i) => {
    const text = getLine(corpus, m.file, m.line) ?? '';
    const body = text.replace(/^\[[^\]]+\]\s+[^:]+:\s*/, '');
    seeded.push({ id: `CHAT-${String(i + 1).padStart(2, '0')}`, statement: body, file: m.file, line: m.line, excerpt: text, author: m.speaker, date: m.timestamp, status: 'VERBAL', workstream: 'Decision channel', source: 'pass0' });
  });
  log(`  ${seeded.length} sheet rows and chat messages indexed deterministically`);

  log('pass 2: hazard detection');
  const p2 = await generateJson<{ findings: Finding[] }>(SYSTEM, pass2Prompt(corpus, requirements, seeded), SCHEMAS.pass2_findings, opts);
  const findings: Finding[] = [];
  (p2.findings ?? []).forEach((f, i) => {
    const v = verifyAll(corpus, f.sources ?? [], f.type);
    if (v.ok) findings.push({ ...f, id: `F-${String(findings.length + 1).padStart(2, '0')}`, sources: v.sources });
    else dropped.push({ pass: 2, id: f.id ?? `candidate-${i + 1}`, reason: v.reason!, item: { ...f, sources: v.sources } });
  });
  const repaired2 = findings.reduce((n, f) => n + f.sources.filter((x) => x.repaired).length, 0);
  log(`  ${findings.length} findings verified (${repaired2} citations corrected from their excerpt), ${(p2.findings ?? []).length - findings.length} dropped`);

  log('pass 3: hazard log entries');
  const entries: HazardEntry[] = [];
  if (findings.length) {
    const p3 = await generateJson<{ entries: Omit<HazardEntry, 'hazard_id' | 'standard_refs'>[] }>(SYSTEM, pass3Prompt(corpus, findings), SCHEMAS.pass3_hazard_entries, opts);
    for (const e of p3.entries ?? []) {
      const v = verifyAll(corpus, e.evidence ?? [], findings.find((f) => f.id === e.finding_id)?.type);
      if (!findings.some((f) => f.id === e.finding_id)) { dropped.push({ pass: 3, id: e.finding_id, reason: 'refers to a finding that was not verified', item: e }); continue; }
      if (!v.ok) { dropped.push({ pass: 3, id: e.finding_id, reason: v.reason!, item: { ...e, evidence: v.sources } }); continue; }
      try { riskRating(e.proposed_severity, e.proposed_likelihood); } catch (err) { dropped.push({ pass: 3, id: e.finding_id, reason: (err as Error).message, item: e }); continue; }
      // The model proposes; this floor only ever raises it, and only for an explicit "severity: Unknown" left active on a live clinical panel (src/risk.ts).
      const calibrated = applySeverityFloor(corpus, { ...e, evidence: v.sources });
      entries.push({
        ...calibrated,
        hazard_id: `HZ-${String(entries.length + 1).padStart(3, '0')}`,
        evidence: v.sources,
        standard_refs: ['DCB0160 4.3.1 identify hazards in normal and fault conditions', 'DCB0160 4.4.1 estimate severity, likelihood and clinical risk', 'DCB0160 3.3.2 CSO approves each version of the Hazard Log'],
      });
    }
    log(`  ${entries.length} hazard entries verified, ${(p3.entries ?? []).length - entries.length} dropped`);
  }

  const run = { engine: 'GEMMA_LOCAL', model: opts.model ?? process.env.HAZLOG_MODEL ?? 'gemma3', timestamp: new Date().toISOString(), execution_ms: Date.now() - t0, corpus_files: corpus.files.map((f) => f.file) };
  return {
    findings: { run, requirements: [...requirements, ...seeded], findings, dropped },
    hazardLog: {
      run: { ...run, note: 'Severity and likelihood are proposals. Nothing here is a confirmed hazard log entry until a Clinical Safety Officer signs it (DCB0160 3.3.2).', standard: { id: 'DCB0160', amendment: 'Amd 25/2018', version: '3.2', published: '7 June 2018', legal_basis: 'Section 250, Health and Social Care Act 2012' } },
      entries,
    },
    index,
  };
}
