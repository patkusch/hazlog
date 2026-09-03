/** `make run`: pre-pass, then the three local passes, then out/*.json. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { ollamaAvailable, DEFAULT_HOST, DEFAULT_MODEL } from './ollama.ts';
import { runPipeline } from './passes.ts';
import { writeIndex } from './prepass.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const corpusDir = opt('--corpus', 'corpus');
const outDir = opt('--out', 'out');
const model = opt('--model', DEFAULT_MODEL);

const avail = await ollamaAvailable(DEFAULT_HOST);
if (!avail.ok) {
  console.error(`Ollama is not reachable at ${DEFAULT_HOST} (${avail.error}).`);
  console.error('Install Ollama, run `ollama pull gemma3`, then retry. `make demo` runs the UI from the committed fixtures without it.');
  process.exit(2);
}
if (!avail.models.some((m) => m === model || m.startsWith(`${model}:`))) {
  console.error(`Model "${model}" is not pulled. Available: ${avail.models.join(', ') || 'none'}. Run: ollama pull ${model}`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
writeIndex(corpusDir, `${outDir}/index.json`);
console.log(`pass 0: wrote ${outDir}/index.json`);
const result = await runPipeline(corpusDir, { model, log: (s) => console.log(s) });
writeFileSync(`${outDir}/findings.json`, JSON.stringify(result.findings, null, 2) + '\n');
writeFileSync(`${outDir}/hazard-log.json`, JSON.stringify(result.hazardLog, null, 2) + '\n');
console.log(`wrote ${outDir}/findings.json (${result.findings.findings.length} findings, ${result.findings.dropped.length} dropped)`);
console.log(`wrote ${outDir}/hazard-log.json (${result.hazardLog.entries.length} entries, all PROPOSED - requires CSO sign-off)`);
