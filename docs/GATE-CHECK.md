# Gate check

The ten criteria from the build spec, and where each one is satisfied in this repo. Target was ~35/40. Items marked *not done* are not done.

| # | Criterion | Where | State |
|---|---|---|---|
| 1 | **Structural gap** — uploading the corpus for compliance review is itself the breach | README *The trap*. Pass 0 counts the identifiable-data locations and the UI shows the number in the header (28 in the fixture corpus: NHS numbers, a date of birth, contract values, safeguarding, named clinicians). Locations only; values are never written to the index. | done |
| 2 | **Forced architecture** — delete the constraint and the design collapses | `src/ollama.ts` refuses any host that is not loopback. `src/gemini.ts` takes one short string, has no import that can read a file, and refuses anything shaped like a line, an NHS number or a citation. `test/boundary.test.ts` asserts all of it, including that a captured Gemini request contains no corpus line. | done |
| 3 | **Model split with written reason** | README *Why these two models* | done |
| 4 | **Artefact output** — a hazard log entry, not a finding | `out/hazard-log.json`; the UI renders the DCB0160 fields (causes, clinical impact, existing controls, initial severity/likelihood/rating, additional controls, owner, evidence, status). Pass 2 findings are the intermediate; Pass 3 is the artefact. | done |
| 5 | **Proof of gap** — obligation + incumbents | README *The obligation* cites DCB0160 v3.2 clauses 2.3.1, 3.1.4, 3.3.1–3.3.3, 4.3.1, 4.4.1 (read from the Requirements Specification PDF). README *The incumbents* table. | done, see caveat on the matrix below |
| 6 | **Human authority boundary** — CSO sign-off state | Every entry ships `PROPOSED · requires CSO sign-off`. The sign-off panel needs a name, allows amendment before signing, records rejection with a reason, and only signed entries export. `test/fixtures.test.ts` fails if any fixture entry carries a confirmed rating, a signature or a residual risk. Residual risk is deliberately not automated. | done |
| 7 | **Degradation ladder** | `make demo` runs off committed fixtures with no network, no Ollama, no key. `make run` exits 2 with the install instruction if Ollama or the model is missing. `make lookup` exits 1 with a one-line message if the key is missing, and refuses document-shaped input before any network call. | done |
| 8 | **Honest limits** | README *Limits* | done |
| 9 | **One-line run** | `make demo` | done |
| 10 | **Name is the verb or the artefact** | HAZLOG, the artefact | done |

## Carried from Aurora, unchanged

- Three-pass structure (extract → detect → entry), now preceded by a deterministic Pass 0.
- The `FILE:LINE` rule: no resolvable citation, no finding. The verifier is stricter than Aurora's: one-directional containment, blank lines and blank excerpts rejected, a minimum excerpt length, and every finding must span two files.
- JSON-on-disk demo path.

## Not done

- **Live Gemma run.** Ollama was not installed on the build machine. The local path is wired, schema-constrained and tested against a refused non-local host; it has not produced a run. `make run` will, and the engine badge will read `GEMMA_LOCAL`.
- **Risk matrix wording.** `shared/risk-matrix.json` reproduces the DCB0160 Implementation Guidance as commonly published; the controlled copy on the NHS England site blocks automated fetches, and the one third-party safety case that reproduces the tables does so as images. Check it against the controlled copy before submission.
- **Demo recording.** None yet.
- Live ingestion, diagrams, residual risk, a persistent hazard log.
