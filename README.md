<div align="center">

# HAZLOG

### Finds the patient-safety hazards hiding between two approved documents

**It reads every design document for a hospital system together, finds where two of them disagree about a patient, and drafts the safety log entry for the Clinical Safety Officer to sign.**
**Those documents are full of patient details, so the reading happens on your own computer and nothing is uploaded.**

<br/>

[![HZ-001 in the demo screen: two approved designs side by side, the lines that disagree highlighted, the draft hazard log entry beneath](./docs/hazlog-hz001.png)](./docs/hazlog-hz001.png)

**The demo screen.** Two approved designs side by side, the lines that disagree highlighted, the draft log entry beneath.
`make demo` needs no network, no model and no key · [What you'll see](#what-youll-see) · [Limits](#limits)

<br/>

[![License](https://img.shields.io/badge/License-MIT-1A1A1A?style=for-the-badge)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-47_passing-2ea043?style=for-the-badge)](./test)
[![Local model](https://img.shields.io/badge/runs_on_a_local_model-Gemma_via_Ollama-1A1A1A?style=for-the-badge)](#why-these-two-models)
[![CI](https://github.com/patkusch/hazlog/actions/workflows/ci.yml/badge.svg)](https://github.com/patkusch/hazlog/actions/workflows/ci.yml)

</div>

---

## The thirty-second version

A hospital is moving 1.4 million allergy records into a new patient record system. Two teams wrote two designs. Both were approved.

> **FLLD-DM-v3.md** *(data migration design, approved 14 January 2026)*, line 26
> *"All migrated allergy records shall be rendered immediately visible and active in the Aurora Allergy & Intolerance clinical summary panel upon initial user login at go-live."*

> **FLLD-CLIN-v2.md** *(clinical design, approved 19 February 2026)*, line 16
> *"The Aurora Allergy & Intolerance clinical summary panel shall be unpopulated and empty at go-live for all migrated patients, to ensure unverified legacy data does not compromise acute prescribing decisions."*

One design fills the allergy screen on day one. The other keeps it empty on purpose, because the old data is not safe to prescribe from. Only one can happen.

HAZLOG found this with a local model (gemma3:12b, 6 min 11 s on an Apple M5 with 16 GB) and wrote it up as a DCB0160 hazard log entry. DCB0160 is the NHS standard that makes a hospital list every way a new clinical system could harm a patient; the hazard log is that list. This is the entry exactly as the model wrote it, from [`docs/runs/gemma3-12b/hazard-log.json`](./docs/runs/gemma3-12b/hazard-log.json):

| | HZ-001 |
|---|---|
| Hazard | Conflicting Allergy Data Visibility |
| Clinical effect | Patients may be exposed to inaccurate or unverified allergy information, potentially leading to adverse drug reactions or inappropriate treatment decisions. |
| Proposed severity · likelihood | Considerable · Medium |
| Proposed control | Resolve the conflict between requirements by ensuring DM-04-R03 is revised to align with CLIN-11-R01 and CLIN-11-R02, preventing migrated allergy data from populating the clinical summary panel at go-live. |
| Proposed owner | Migration Architect |
| Evidence | `FLLD-CLIN-v2.md:16` ✓ · `FLLD-DM-v3.md:26` ✓ |

**Both quotes were checked against the source line before the entry was shown. Nothing is a log entry until a named Clinical Safety Officer signs it.**

The same run missed the sharper problem inside this contradiction, and a Clinical Safety Officer would raise Considerable to Major. Both are written up under [Live runs](#live-runs).

---

## The room

The demo screen above shows the sharper problem inside that contradiction.

The data migration design, approved 14 January, says that when the migration cannot parse a severity from a legacy note, the record goes live anyway with severity set to **"Unknown"**, active and visible in the clinical panel.

The clinical design, approved 19 February and reviewed by the consultant anaesthetist who is also the trust's Clinical Safety Officer, says the allergy panel is **empty** at go-live and clinicians capture allergies from the patient at the **first appointment after cutover**.

Each document is correct on its own.

## The consequence

Together they mean a patient with a documented anaphylaxis can present after go-live with the allergy recorded as severity Unknown. The prescribing hard-stop that forces reconciliation exempts emergency orders. The remedy the clinical design relies on, capture at first appointment, is the appointment the patient is already in.

## Why nobody caught it

Data migration owns one document. Clinical design owns the other. The decision that would have reconciled them was taken in a Teams channel on 3 March, and it reached neither: the walkthrough that would have minuted it was cancelled, the change request was deferred, and the approved design still says what it said in January.

No role in the programme reads all four artefacts as one corpus.

## The obligation

DCB0160 (Amd 25/2018, v3.2), mandated under section 250 of the Health and Social Care Act 2012, requires the deploying organisation to:

- identify and document known and foreseeable hazards to patients, in normal and fault conditions (4.3.1)
- estimate severity, likelihood and clinical risk for each one (4.4.1), recorded in the Hazard Log (guidance 4.4.2)
- keep a Hazard Log, each version approved by a Clinical Safety Officer who is a suitably qualified clinician (3.3.1, 3.3.2, 2.3.1)
- record every decision that influences clinical risk in the Clinical Risk Management File (3.1.4)

The hazard above is not in the hazard log. The standard obliges you to log the hazards you have identified. It does not help you find the ones that live in the space between two separately approved documents.

## The trap

So put a language model on the corpus. Except the corpus is:

- patient-identifiable clinical detail (an NHS number, a name, a date of birth and an anaphylaxis history, pasted into chat as a worked example)
- supplier contract values (a decommission fee per quarter of delay)
- named clinicians discussing a child's safeguarding flag

Uploading that to a public model to look for compliance problems is the compliance problem.

## The incumbents

These artefacts live in tools today. None of those tools reads across them, and all of them are cloud.

| Tool | Holds | Reads across artefacts? | Where it runs |
|---|---|---|---|
| Jira | Tickets, decisions | No | Cloud |
| DOORS | Formal requirements | Within a module only | Cloud / on-prem, licensed |
| Confluence | Design docs | No | Cloud |
| SharePoint | Everything, unstructured | No | Cloud |

## The build

A local Gemma model reads all four artefacts as one corpus and returns candidate hazards. Every hazard cites at least two sources by file and line, and anything that claims a relationship between documents (a contradiction, a silent default, a verbal override, an orphan dependency) must cite two different documents; an unowned decision may live in two lines of one channel. Every citation is checked in code against the source text before it is shown. The excerpt is the proof: if the model quotes a line verbatim but mislabels where it came from, and the quote is found on exactly one line of the corpus, the address is corrected to that line and shown as corrected. A quote that is nowhere in the corpus, or in several places, is discarded with its finding. Gemini goes online only for isolated terms: a SNOMED code, a standard reference. It never sees a document line.

```
corpus/                       local, never leaves the machine
  FLLD-DM-v3.md               data migration design
  FLLD-CLIN-v2.md             clinical design
  field-mapping.csv           legacy -> target field map
  teams-export.txt            decision channel export
        |
  Pass 0  deterministic pre-pass          no model
        |   requirement IDs, approvals, dates, roles, fields, CSV rows,
        |   chat messages, SNOMED codes, identifiable-data locations
        |   -> out/index.json
  Pass 1  extraction                      Gemma, local, schema-constrained
  Pass 2  hazard detection                Gemma, local, schema-constrained
        |   each candidate cites >= 2 sources in >= 2 files, FILE:LINE
  Pass 3  hazard log entry                Gemma, local, schema-constrained
        |   causes, clinical effect, proposed severity and likelihood,
        |   controls, owner, evidence
        v
  out/findings.json  out/hazard-log.json
        |
  UI: two source panes side by side, the entry beneath, CSO sign-off state

  Gemini (online, optional, one function): a term in, a lookup out.
```

**Invariant:** the corpus never leaves the machine. Every run reported here, including both live Gemma runs below, executed against a loopback Ollama with no other network access. Gemini receives only isolated terms, never document content. This is enforced in code, not prose: the local client refuses any host that is not loopback, the Gemini client has no import that can read a file and takes a single short string, and `test/boundary.test.ts` asserts all three.

## Why these two models

Local is required, not preferred. See [the trap](#the-trap). Cross-document reading is the work that touches every identifiable line, so it runs on Gemma through Ollama on the machine that already holds the corpus.

Gemini handles what a local model cannot: the current text and version of a standard, and live terminology lookup. Those are single terms, so they can go online.

## What you'll see

`make demo` opens a page that reads the committed `out/*.json`. Select a hazard. The two source documents render side by side with the contradicting lines highlighted, each labelled with its file, its line, and whether the quoted excerpt was found on that line. The DCB0160 hazard log entry is beneath: causes, clinical effect, proposed severity and likelihood with the standard's definitions, the computed initial risk rating, proposed controls, proposed owner, evidence, and the state **PROPOSED · requires CSO sign-off**.

The sign-off panel is pre-filled with the proposal. A named Clinical Safety Officer can confirm it, amend severity or likelihood before signing, or reject it with a reason. Only signed entries export. Residual risk is deliberately not automated.

The selector in the header switches between the authored fixture and the two live runs archived under `docs/runs/`; the badge says which one you are looking at and how long the real run took.

Five entries ship in the fixture, from the same corpus:

| | Hazard | Proposed |
|---|---|---|
| HZ-001 | Severe allergy presented as severity Unknown in an active record at go-live | Major · High · risk 4 |
| HZ-002 | Unmapped legacy allergen coded as *No known allergy* (SNOMED 716186003) | Catastrophic · Medium · risk 4 |
| HZ-003 | Approved design and build artefacts disagree on severity derivation; the decision exists only in chat | Considerable · High · risk 3 |
| HZ-004 | Ward location codes migrate through an undefined lookup | Significant · Medium · risk 2 |
| HZ-005 | Paediatric safeguarding note truncated by migration; ownership declined | Major · Low · risk 3 |

## Live runs

Both runs are the shipped code against the same corpus, on the machine this was built on (Apple M5, 16 GB), through Ollama on loopback. The outputs are committed unedited under `docs/runs/` and held to the same tests as the fixture: every quote must resolve to its line.

| | gemma3 (4B) | gemma3:12b |
|---|---|---|
| Wall clock, three passes | 90 s | 6 min 11 s |
| Design requirements extracted with exact provenance | 9 of 15 | 15 of 15 |
| Addresses corrected from the excerpt | 3 | 5 |
| Findings that passed verification | 2 | 3 |
| Candidates discarded | 0 | 0 |
| Planted defects found (of 5) | 1, loosely | 3: the panel contradiction, the unowned safeguarding decision, the ward-code orphan |
| Proposed severity for the headline hazard | Significant · Medium | Considerable · Medium |

The first 4B run, before excerpt-anchored correction, produced zero findings: every candidate quoted a real line and mislabelled its address, and the verifier dropped all of them. That run is what motivated the correction rule, and the rule is deliberately narrow: a quote is only re-addressed when it exists on exactly one line.

What the 12B run got right is the point of the build: it found the contradiction at the top of this page unprompted, and nothing made up survived to the page. What it missed is the honest part: the *severity Unknown* mechanism inside that contradiction, the *No known allergy* fallback, and the cancelled-in-chat severity derivation. A Clinical Safety Officer would also raise its Considerable to Major.

## Run it

Node 24 or later. Nothing to install: the TypeScript runs directly.

```bash
make demo        # UI from the committed fixtures. No network, no Ollama, no key.
make test        # verifier, fixtures, boundary, pre-pass
make prepass     # Pass 0 only, deterministic: out/index.json
make run         # Pass 0 + three local Gemma passes via Ollama -> out/*.json
make lookup TERM=716186003   # the narrow online path (needs GEMINI_API_KEY)
```

For `make run`: install [Ollama](https://ollama.com), then `ollama pull gemma3`. On a 16 GB machine `ollama pull gemma3:12b` and `HAZLOG_MODEL=gemma3:12b make run` is markedly better and takes about six minutes.

## Limits

- **The corpus is synthetic.** Four artefacts, written for this demo to contain five defects. It is shaped like a real programme's artefacts; it is not one.
- **Severity and likelihood are proposals.** The rating is computed from the matrix, never asserted by the model, and none of it is a hazard log entry until a named CSO signs. The UI records the signature in the browser only.
- **The fixture is the default view, not the only one.** `out/hazard-log.json` was authored to show all five planted defects. The live runs in `docs/runs/` are what the local model actually produces; the 12B run finds three of the five. Both are held to the same tests: every quote resolves to its line, every relationship finding spans two documents.
- **Verified means the quote is there, not that it supports the claim.** In the 12B run, HZ-003 (ward-code orphan dependency) reasons correctly from Row 12 of the mapping sheet and two chat lines, then cites line 41 of the migration design, which is the paediatric verification flag and says nothing about ward codes. The line is real, the quote is verbatim, the citation verifies, and it is the wrong evidence. Provenance checking catches fabrication; it does not catch irrelevance. That is a reviewer's job and the UI puts the line in front of them for that reason.
- **Four artefacts.** Cross-document detection at this corpus size fits in one context window. Beyond that it needs chunking and a second pass over pairs, and that is not built.
- **The risk matrix** in `shared/risk-matrix.json` is Tables 7 to 10 of the DCB0160 Implementation Guidance v4.2 (02.05.2018), checked cell for cell against the official PDF on 3 September 2026 and pinned by a test. The guidance calls those tables *examples*: an organisation's own Clinical Risk Management Plan (3.2.1) defines the criteria it actually uses, so a trust would swap in its own. Clause numbers are from the Requirements Specification v3.2.
- **The Gemini lookup** is one function and has not been exercised against a live key here. It is tested with a fake fetch that captures the request and checks no corpus line is in it.
- **Not wired:** live ingestion from Confluence, Jira or Teams; diagrams; residual-risk assessment; a persistent hazard log beyond the browser.

## Layout

```
corpus/           the four synthetic artefacts
shared/           schema.json (constrained decoding), risk-matrix.json
src/              corpus.ts (loader + verifier) · prepass.ts · passes.ts · ollama.ts · gemini.ts · risk.ts · run.ts
out/              index.json (generated) · findings.json · hazard-log.json (committed fixtures)
ui/index.html     the page
server.mjs        `make demo`
test/             verifier · fixtures · boundary · prepass
```

## License

MIT.
