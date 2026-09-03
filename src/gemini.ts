/**
 * The narrow online path. One function. Takes a term. Returns a lookup.
 *
 * This module has no import of corpus.ts, prepass.ts, or anything that can
 * read the corpus directory, and its only parameter is a short string.
 * test/boundary.test.ts asserts both. The corpus never leaves the machine;
 * Gemini sees a SNOMED code or a standard reference, never a document line.
 */
export type Lookup = { term: string; kind: 'snomed' | 'standard' | 'term'; answer: string; model: string; sent: string };

const MAX_TERM = 120;
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

function classify(term: string): Lookup['kind'] {
  if (/^\d{6,18}$/.test(term)) return 'snomed';
  if (/^DCB\s?0(129|160)\b/i.test(term)) return 'standard';
  return 'term';
}

function questionFor(term: string, kind: Lookup['kind']): string {
  if (kind === 'snomed') return `What is the preferred term and semantic tag of SNOMED CT concept ${term}? Answer in one line. If unsure, say so.`;
  if (kind === 'standard') return `What is the current version, amendment number and publication date of NHS information standard ${term}, and what does it require in one sentence? Answer in two lines.`;
  return `Define the clinical or NHS information-governance term "${term}" in one sentence.`;
}

/** Reject anything that looks like document content rather than a term. */
export function assertIsTerm(term: string): void {
  if (typeof term !== 'string') throw new Error('term must be a string');
  const t = term.trim();
  if (!t) throw new Error('term is empty');
  if (t.length > MAX_TERM) throw new Error(`term too long (${t.length} > ${MAX_TERM}); this path is for isolated terms only`);
  if (/\n/.test(t)) throw new Error('term contains a line break; document content is not allowed here');
  if (/\b\d{3}\s\d{3}\s\d{4}\b/.test(t)) throw new Error('term looks like an NHS number; refused');
  if (/\.(md|csv|txt):\d+/.test(t)) throw new Error('term contains a FILE:LINE citation; refused');
}

export async function lookup(term: string, fetchImpl: typeof fetch = fetch): Promise<Lookup> {
  assertIsTerm(term);
  const t = term.trim();
  const kind = classify(t);
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. The lookup path is optional; the pipeline and demo run without it.');
  const sent = questionFor(t, kind);
  const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: sent }] }], generationConfig: { temperature: 0 } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const answer = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return { term: t, kind, answer: answer.trim(), model: MODEL, sent };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const term = process.argv.slice(2).join(' ');
  lookup(term)
    .then((l) => {
      console.log(`sent to Gemini (${l.model}): ${JSON.stringify(l.sent)}`);
      console.log(l.answer);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
