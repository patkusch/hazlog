/**
 * Local model client. Talks only to the Ollama socket on this machine.
 * `format` is a JSON schema: Ollama constrains decoding to it, so a pass
 * either returns the shape we asked for or throws.
 */
export type OllamaOptions = { host?: string; model?: string; temperature?: number; num_ctx?: number };

export const DEFAULT_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
export const DEFAULT_MODEL = process.env.HAZLOG_MODEL ?? 'gemma3';

export async function ollamaAvailable(host = DEFAULT_HOST): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const r = await fetch(`${host}/api/tags`);
    if (!r.ok) return { ok: false, models: [], error: `HTTP ${r.status}` };
    const j = (await r.json()) as { models?: { name: string }[] };
    return { ok: true, models: (j.models ?? []).map((m) => m.name) };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }
}

function assertLocal(host: string) {
  const u = new URL(host);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) {
    throw new Error(`Refusing to send corpus content to a non-local host: ${host}. The corpus never leaves the machine.`);
  }
}

export async function generateJson<T>(
  system: string,
  prompt: string,
  schema: object,
  opts: OllamaOptions = {},
): Promise<T> {
  const host = opts.host ?? DEFAULT_HOST;
  assertLocal(host);
  const body = {
    model: opts.model ?? DEFAULT_MODEL,
    system,
    prompt,
    format: schema,
    stream: false,
    options: { temperature: opts.temperature ?? 0.1, num_ctx: opts.num_ctx ?? 16384 },
  };
  const r = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { response: string };
  try {
    return JSON.parse(j.response) as T;
  } catch (e) {
    throw new Error(`Model output was not valid JSON despite schema constraint: ${(e as Error).message}\n${j.response.slice(0, 500)}`);
  }
}
