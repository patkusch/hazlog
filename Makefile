# HAZLOG. Node 24+ runs the TypeScript directly; there is nothing to install.
.PHONY: demo prepass run test lookup clean

## demo: the UI off the committed fixtures. No network, no Ollama, no key.
demo:
	node server.mjs

## prepass: Pass 0 only. Deterministic index of the corpus (no model).
prepass:
	node src/prepass.ts corpus out/index.json

## run: Pass 0 + three local Gemma passes via Ollama, then out/*.json.
run:
	node src/run.ts --corpus corpus --out out

## test: the verifier, the fixtures, the boundary, the pre-pass.
test:
	node --test test/*.test.ts

## lookup: the narrow online path. make lookup TERM=716186003
lookup:
	node src/gemini.ts "$(TERM)"

clean:
	rm -f out/index.json
