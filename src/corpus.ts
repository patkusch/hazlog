/**
 * Corpus loader and the one rule everything else depends on:
 * a citation is FILE:LINE, and it is checked here, in code, against the
 * original text. Nothing a model asserts about provenance is trusted.
 *
 * The corpus never leaves this process except to the local Ollama socket.
 * There is deliberately no import of the Gemini client anywhere in this file,
 * and the Gemini client has no import of this file. See test/boundary.test.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

export type CorpusLine = { file: string; line: number; text: string };
export type CorpusFile = { file: string; path: string; sha256: string; lines: string[] };
export type Corpus = { dir: string; files: CorpusFile[] };

const ALLOWED = new Set(['.md', '.csv', '.txt']);

export function loadCorpus(dir: string): Corpus {
  const files: CorpusFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    const ext = name.slice(name.lastIndexOf('.'));
    if (!ALLOWED.has(ext)) continue;
    const raw = readFileSync(path, 'utf8');
    files.push({
      file: basename(name),
      path,
      sha256: createHash('sha256').update(raw).digest('hex'),
      // Keep a trailing newline from producing a phantom empty last line.
      lines: raw.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'),
    });
  }
  if (files.length === 0) throw new Error(`No corpus files (.md/.csv/.txt) found in ${dir}`);
  return { dir, files };
}

/** Every (file, line, text) triple in the corpus, 1-indexed. */
export function corpusLines(corpus: Corpus): CorpusLine[] {
  const out: CorpusLine[] = [];
  for (const f of corpus.files) f.lines.forEach((text, i) => out.push({ file: f.file, line: i + 1, text }));
  return out;
}

/** The text handed to a local model: every line prefixed FILE:LINE| */
export function prefixedCorpus(corpus: Corpus): string {
  return corpusLines(corpus).map((l) => `${l.file}:${l.line}| ${l.text}`).join('\n');
}

export function getLine(corpus: Corpus, file: string, line: number): string | undefined {
  const f = corpus.files.find((x) => x.file === file);
  if (!f) return undefined;
  if (!Number.isInteger(line) || line < 1 || line > f.lines.length) return undefined;
  return f.lines[line - 1];
}

export type Citation = { file: string; line: number; excerpt: string };
export type Verification = { verified: boolean; reason: string; actual?: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A citation verifies only if the file exists, the line exists, the line is
 * not blank, the excerpt is not blank, and the excerpt is a substring of the
 * line. Containment is one-directional on purpose: Aurora's verifier accepted
 * containment either way and a fabricated quote aimed at a blank line passed.
 * An excerpt shorter than MIN_EXCERPT characters is rejected because a
 * three-letter "excerpt" will match almost any line.
 */
export const MIN_EXCERPT = 12;

export function verifyCitation(corpus: Corpus, c: Citation): Verification {
  const actual = getLine(corpus, c.file, c.line);
  if (actual === undefined) return { verified: false, reason: 'file or line does not exist' };
  const a = norm(actual);
  const e = norm(c.excerpt ?? '');
  if (!a) return { verified: false, reason: 'cited line is blank', actual };
  if (!e) return { verified: false, reason: 'excerpt is blank', actual };
  if (e.length < MIN_EXCERPT) return { verified: false, reason: `excerpt shorter than ${MIN_EXCERPT} chars`, actual };
  if (!a.includes(e)) return { verified: false, reason: 'excerpt is not on the cited line', actual };
  return { verified: true, reason: 'excerpt found on cited line', actual };
}
