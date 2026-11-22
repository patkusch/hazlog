# Working in hazlog

Cross-document clinical hazard detection for DCB0160. Local Gemma reads the corpus; Gemini sees only isolated terms.

## Run the tests

You need Node 24 or newer.

```bash
make test
```

Every test should pass before you start and after you finish.

## Where things are

- `src/`: the code
- `test/`: the tests
- `docs/`: written documentation

## Before you commit

- Make sure the tests pass.
- Put changes people will notice in `CHANGELOG.md`.
- Do not put real passwords, keys or private data in test files or examples. Use made-up ones.
