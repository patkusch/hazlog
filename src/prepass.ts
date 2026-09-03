/**
 * Pass 0: deterministic pre-pass. No model.
 *
 * Builds out/index.json from regex and rules: requirement IDs, document
 * references, approval blocks, named roles, dates, field names, CSV rows,
 * chat messages, SNOMED codes, and a count of identifiable-data signals.
 * Everything carries FILE:LINE. This is what makes provenance exact rather
 * than model-asserted: later passes may only cite lines that exist here.
 */
import { loadCorpus, corpusLines, type Corpus } from './corpus.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type Loc = { file: string; line: number };
export type Index = {
  generated_at: string;
  corpus_dir: string;
  files: { file: string; lines: number; sha256: string; kind: 'design' | 'csv' | 'chat' | 'other' }[];
  requirement_ids: (Loc & { id: string; heading?: string })[];
  document_refs: (Loc & { ref: string })[];
  approvals: (Loc & { name: string; role: string; date: string })[];
  header_fields: (Loc & { key: string; value: string })[];
  dates: (Loc & { value: string })[];
  field_names: (Loc & { name: string })[];
  csv_rows: (Loc & Record<string, string>)[];
  chat_messages: (Loc & { timestamp: string; speaker: string })[];
  snomed_codes: (Loc & { code: string })[];
  /** Locations only. Values are never written to the index. */
  identifiable_data: { kind: string; file: string; line: number }[];
};

const RE = {
  reqId: /\b([A-Z]{2,6}-\d{2}-R\d{2})\b/g,
  docRef: /\b(F[A-Z]{2,4}-[A-Z]{2,6}-\d{2})\b/g,
  approval: /^-\s*(.+?),\s*(.+?)\s*\(Approved:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})\)/,
  header: /^\*\*([^*]+):\*\*\s*(.+?)\s*$/,
  heading: /^###\s+([A-Z]{2,6}-\d{2}-R\d{2}):\s*(.+)$/,
  date: /\b(\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/g,
  fieldName: /\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g,
  chat: /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s+([^:]+):\s/,
  snomed: /\b(\d{6,18})\b/g,
  nhsNumber: /\b\d{3}\s\d{3}\s\d{4}\b/,
  dob: /\bDOB\s+\d{2}\/\d{2}\/\d{4}\b/i,
  money: /£\s?\d[\d,]*(?:\.\d+)?\s?[km]?\b/i,
  safeguarding: /\bsafeguarding\b/i,
};

function kindOf(file: string): Index['files'][number]['kind'] {
  if (file.endsWith('.csv')) return 'csv';
  if (/teams|chat|export/i.test(file) && file.endsWith('.txt')) return 'chat';
  if (file.endsWith('.md')) return 'design';
  return 'other';
}

function parseCsvLine(s: string): string[] {
  return s.split(',').map((x) => x.trim());
}

export function buildIndex(corpus: Corpus): Index {
  const idx: Index = {
    generated_at: new Date().toISOString(),
    corpus_dir: corpus.dir,
    files: corpus.files.map((f) => ({ file: f.file, lines: f.lines.length, sha256: f.sha256, kind: kindOf(f.file) })),
    requirement_ids: [], document_refs: [], approvals: [], header_fields: [], dates: [],
    field_names: [], csv_rows: [], chat_messages: [], snomed_codes: [], identifiable_data: [],
  };
  const csvHeaders = new Map<string, string[]>();

  for (const { file, line, text } of corpusLines(corpus)) {
    const loc = { file, line };
    const kind = kindOf(file);

    const h = text.match(RE.heading);
    if (h) idx.requirement_ids.push({ ...loc, id: h[1], heading: h[2].trim() });
    else for (const m of text.matchAll(RE.reqId)) idx.requirement_ids.push({ ...loc, id: m[1] });

    for (const m of text.matchAll(RE.docRef)) idx.document_refs.push({ ...loc, ref: m[1] });

    const a = text.match(RE.approval);
    if (a) idx.approvals.push({ ...loc, name: a[1].trim(), role: a[2].trim(), date: a[3] });

    const hf = text.match(RE.header);
    if (hf) idx.header_fields.push({ ...loc, key: hf[1].trim(), value: hf[2].trim() });

    for (const m of text.matchAll(RE.date)) idx.dates.push({ ...loc, value: m[1] });
    for (const m of text.matchAll(RE.fieldName)) idx.field_names.push({ ...loc, name: m[1] });

    if (/snomed/i.test(text) || kind === 'csv') {
      for (const m of text.matchAll(RE.snomed)) idx.snomed_codes.push({ ...loc, code: m[1] });
    }

    if (kind === 'csv') {
      const cells = parseCsvLine(text);
      if (line === 1) csvHeaders.set(file, cells);
      else {
        const hdr = csvHeaders.get(file) ?? [];
        const row: Record<string, string> = {};
        hdr.forEach((k, i) => (row[k] = cells[i] ?? ''));
        idx.csv_rows.push({ ...loc, ...row });
      }
    }

    if (kind === 'chat') {
      const c = text.match(RE.chat);
      if (c) idx.chat_messages.push({ ...loc, timestamp: c[1], speaker: c[2].trim() });
    }

    if (RE.nhsNumber.test(text)) idx.identifiable_data.push({ kind: 'nhs_number', ...loc });
    if (RE.dob.test(text)) idx.identifiable_data.push({ kind: 'date_of_birth', ...loc });
    if (RE.money.test(text)) idx.identifiable_data.push({ kind: 'contract_value', ...loc });
    if (RE.safeguarding.test(text)) idx.identifiable_data.push({ kind: 'safeguarding', ...loc });
  }
  // Every chat speaker and every approver is a named individual.
  for (const c of idx.chat_messages) idx.identifiable_data.push({ kind: 'named_clinician', file: c.file, line: c.line });
  for (const a of idx.approvals) idx.identifiable_data.push({ kind: 'named_clinician', file: a.file, line: a.line });
  return idx;
}

export function writeIndex(corpusDir: string, outPath: string): Index {
  const corpus = loadCorpus(corpusDir);
  const idx = buildIndex(corpus);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(idx, null, 2) + '\n');
  return idx;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const corpusDir = process.argv[2] ?? 'corpus';
  const out = process.argv[3] ?? 'out/index.json';
  const idx = writeIndex(corpusDir, out);
  const pii = idx.identifiable_data.reduce<Record<string, number>>((acc, x) => ((acc[x.kind] = (acc[x.kind] ?? 0) + 1), acc), {});
  console.log(`index: ${idx.files.length} files, ${idx.files.reduce((n, f) => n + f.lines, 0)} lines`);
  console.log(`  requirement ids ${idx.requirement_ids.length}, approvals ${idx.approvals.length}, csv rows ${idx.csv_rows.length}, chat messages ${idx.chat_messages.length}, snomed ${idx.snomed_codes.length}`);
  console.log(`  identifiable-data signals: ${JSON.stringify(pii)} (locations only; values are not written)`);
  console.log(`wrote ${out}`);
}
