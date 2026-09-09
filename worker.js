// Vouch service: a thin Cloudflare Worker over the model-agnostic core in src/.
// It injects a Workers AI model backend and exposes the endpoints and demo.
//
//   POST /verify   {claim, source, mode?}        -> Verdict
//   POST /ground   {prompt, sources:[{id,text}]} -> GroundingRecord
//   POST /validate {record}                      -> structural conformance result
//   GET  /                                       -> demo page

import { verifyClaim, ground } from './src/core.js';
import { PROTOCOL_VERSION, validateRecord } from './src/record.js';
import { DEMO_HTML } from './src/demo.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

// The injected backend: try the configured model, fall back to a smaller one.
function makeModel(env) {
  const model = env.MODEL || DEFAULT_MODEL;
  return async (messages) => {
    try {
      return (await env.AI.run(model, { messages, temperature: 0.1, max_tokens: 500 })).response ?? '';
    } catch (e) {
      if (model !== FALLBACK_MODEL) return (await env.AI.run(FALLBACK_MODEL, { messages, temperature: 0.1, max_tokens: 500 })).response ?? '';
      throw e;
    }
  };
}

const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
});
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), { status, headers: { 'content-type': 'application/json; charset=UTF-8', ...cors() } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

    try {
      if (url.pathname === '/verify' && request.method === 'POST') {
        const { claim, source, mode } = await request.json();
        if (!claim || !source) return json({ error: 'send {claim, source}' }, 400);
        const fast = (mode || url.searchParams.get('mode')) === 'fast';
        const v = await verifyClaim(makeModel(env), String(claim), String(source), 's1', fast ? { decompose: false, adversarial: false } : {});
        return json({ protocol: PROTOCOL_VERSION, claim, mode: fast ? 'fast' : 'strict', ...v });
      }
      if (url.pathname === '/ground' && request.method === 'POST') {
        const { prompt, sources } = await request.json();
        if (!prompt || !Array.isArray(sources) || !sources.length) return json({ error: 'send {prompt, sources:[{id,text}]}' }, 400);
        return json(await ground(makeModel(env), String(prompt), sources.slice(0, 8), { modelName: env.MODEL || DEFAULT_MODEL }));
      }
      if (url.pathname === '/validate' && request.method === 'POST') {
        const { record } = await request.json();
        return json({ protocol: PROTOCOL_VERSION, ...validateRecord(record) });
      }
      if (url.pathname === '/') return new Response(DEMO_HTML, { headers: { 'content-type': 'text/html; charset=UTF-8', ...cors() } });
      return json({ error: 'not found', try: ['POST /verify', 'POST /ground', 'POST /validate', 'GET /'] }, 404);
    } catch (e) {
      const quota = /3040|4006|allocation|neurons|capacity/i.test(String(e));
      return json({ error: quota ? 'grader is resting (daily AI allowance reached)' : 'grader error', detail: String(e).slice(0, 200) }, 503);
    }
  },
};
