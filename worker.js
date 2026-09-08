// Vouch — Phase 1 PoC of the Grounding Protocol.
//
//   POST /verify  {claim, source}            -> Verdict          (the primitive)
//   POST /ground  {prompt, sources:[...]}    -> GroundingRecord  (born-grounded)
//   GET  /                                   -> a paste-and-see demo page
//
// The enforcement guarantee is code-level, not vibes: to accept "supported" or
// "refuted" the grader must return a quote, and the code checks that quote is an
// actual substring of the source. A grader that invents its evidence is downgraded
// to cannot_determine. Everything runs on Cloudflare Workers AI (free daily
// allowance); when it is exhausted the AI call throws and we return a clean 503.
//
// Grader model is swappable via env.MODEL; a stronger model (70b, or Claude behind
// a different backend) raises grading quality. The loop and the record are the point.

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const PROTOCOL_VERSION = '0.1';

const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
});
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', ...cors() },
  });

// --- helpers -----------------------------------------------------------------
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Is `quote` really present in `source` (whitespace-insensitive)? This is the
// extractive guarantee: the grader cannot support a claim with invented evidence.
function quoteIsInSource(quote, source) {
  const q = norm(quote).toLowerCase();
  if (q.length < 4) return false;
  return norm(source).toLowerCase().includes(q);
}

function firstJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Returns `.response`, which Workers AI hands back as a STRING for some models and
// an already-parsed OBJECT for others (newer models with structured output).
async function runModel(env, messages) {
  const model = env.MODEL || DEFAULT_MODEL;
  try {
    const r = await env.AI.run(model, { messages, temperature: 0.1, max_tokens: 500 });
    return r.response ?? '';
  } catch (e) {
    if (model !== FALLBACK_MODEL) {
      const r = await env.AI.run(FALLBACK_MODEL, { messages, temperature: 0.1, max_tokens: 500 });
      return r.response ?? '';
    }
    throw e;
  }
}

const asVerdict = (raw) => (raw && typeof raw === 'object' ? raw : firstJson(raw) || {});
const asText = (raw) => (typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''));

const VERIFY_SYSTEM = `You are a strict grounding checker. You are given a SOURCE and a CLAIM.
Decide, using ONLY the SOURCE and never any outside knowledge, whether the source backs the claim.
- "supported": the source explicitly states or directly entails the claim. You MUST quote the exact sentence(s) from the source, copied verbatim, that show it.
- "refuted": the source directly contradicts the claim. Quote the exact contradicting sentence(s).
- "cannot_determine": the source neither clearly supports nor contradicts the claim (it is missing, vague, only loosely related, or would need outside knowledge or a guess).
Be conservative. If support is partial, inferred, or requires anything beyond what the source literally says, answer cannot_determine.
Reply with ONLY a JSON object, no prose:
{"status":"supported|refuted|cannot_determine","quote":"exact substring copied from the SOURCE, or empty string","confidence":0.0,"rationale":"one short sentence"}`;

// The primitive: verify one claim against one source string.
async function verify(env, claim, source, sourceId = 's1') {
  const raw = await runModel(env, [
    { role: 'system', content: VERIFY_SYSTEM },
    { role: 'user', content: `SOURCE:\n"""\n${source}\n"""\n\nCLAIM:\n"""\n${claim}\n"""` },
  ]);
  const parsed = asVerdict(raw);
  let status = ['supported', 'refuted', 'cannot_determine'].includes(parsed.status) ? parsed.status : 'cannot_determine';
  const quote = typeof parsed.quote === 'string' ? parsed.quote : '';
  let confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
  const rationale = norm(parsed.rationale) || 'No rationale returned.';

  // Code-level extractive guarantee: a supported/refuted verdict MUST quote real
  // source text. If it does not, the grader invented its evidence -> downgrade.
  let note = '';
  const anchors = [];
  if (status === 'supported' || status === 'refuted') {
    if (quoteIsInSource(quote, source)) {
      anchors.push({ source_id: sourceId, quote: norm(quote), relation: status === 'supported' ? 'supports' : 'refutes' });
    } else {
      status = 'cannot_determine';
      confidence = Math.min(confidence, 0.4);
      note = 'downgraded: the grader did not quote verbatim source text';
    }
  }
  return { status, anchors, confidence, rationale, ...(note ? { note } : {}) };
}

// Split generated prose into candidate factual claims (one per sentence for the PoC).
function toClaims(text) {
  return norm(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

const GROUND_SYSTEM = `You write strictly from provided sources. Use ONLY the SOURCES given, never outside knowledge.
Write short, factual sentences. Do not add background, context, or anything the sources do not state.
If the question asks for something the sources do not cover, do not invent it.
Return only the answer prose, no citations or preamble.`;

// The loop: generate constrained to the sources, then verify every claim and build
// the grounding record. Unsupported claims are replaced in the grounded text with an
// honest marker (PoC-level repair; full regenerate-in-place is Phase 2).
async function ground(env, prompt, sources) {
  const srcBlock = sources.map((s, i) => `[${s.id || 's' + (i + 1)}] ${s.text}`).join('\n\n');
  const draft = await runModel(env, [
    { role: 'system', content: GROUND_SYSTEM },
    { role: 'user', content: `SOURCES:\n"""\n${srcBlock}\n"""\n\nQUESTION:\n${prompt}` },
  ]);

  const claims = [];
  const groundedParts = [];
  for (const text of toClaims(asText(draft))) {
    // Check the claim against each source; first support wins its anchor.
    let best = { status: 'cannot_determine', anchors: [], confidence: 0.3, rationale: 'No source supports this.' };
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const v = await verify(env, text, s.text, s.id || 's' + (i + 1));
      if (v.status === 'supported') { best = v; break; }
      if (v.status === 'refuted') { best = v; break; }
      if (v.confidence > best.confidence) best = v;
    }
    const status = best.status === 'supported' ? 'sourced' : best.status === 'refuted' ? 'refuted' : 'abstained';
    claims.push({ id: `c${claims.length + 1}`, text, status, anchors: best.anchors, confidence: best.confidence, rationale: best.rationale });
    groundedParts.push(status === 'sourced' ? text : `[could not source: ${text}]`);
  }

  return {
    protocol: PROTOCOL_VERSION,
    content: groundedParts.join(' '),
    draft: asText(draft),
    sources: sources.map((s, i) => ({ id: s.id || 's' + (i + 1), title: s.title || null })),
    claims,
    meta: { model: env.MODEL || DEFAULT_MODEL, mode: 'advisory', created_at: new Date().toISOString(), enforcer: `vouch-poc/${PROTOCOL_VERSION}` },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

    try {
      if (url.pathname === '/verify' && request.method === 'POST') {
        const { claim, source } = await request.json();
        if (!claim || !source) return json({ error: 'send {claim, source}' }, 400);
        if (url.searchParams.get('debug')) {
          const model = env.MODEL || DEFAULT_MODEL;
          let raw, usedModel = model, err = null;
          try { raw = (await env.AI.run(model, { messages: [{ role: 'system', content: VERIFY_SYSTEM }, { role: 'user', content: `SOURCE:\n"""\n${source}\n"""\n\nCLAIM:\n"""\n${claim}\n"""` }], temperature: 0.1, max_tokens: 500 })).response; }
          catch (e) { err = String(e).slice(0, 200); usedModel = FALLBACK_MODEL; try { raw = (await env.AI.run(FALLBACK_MODEL, { messages: [{ role: 'system', content: VERIFY_SYSTEM }, { role: 'user', content: `SOURCE:\n${source}\n\nCLAIM:\n${claim}` }], temperature: 0.1, max_tokens: 500 })).response; } catch (e2) { err += ' | fallback: ' + String(e2).slice(0, 120); } }
          return json({ debug: true, model: usedModel, err, raw });
        }
        const v = await verify(env, String(claim), String(source));
        return json({ protocol: PROTOCOL_VERSION, claim, ...v });
      }
      if (url.pathname === '/ground' && request.method === 'POST') {
        const { prompt, sources } = await request.json();
        if (!prompt || !Array.isArray(sources) || !sources.length) return json({ error: 'send {prompt, sources:[{id,text}]}' }, 400);
        return json(await ground(env, String(prompt), sources.slice(0, 8)));
      }
      if (url.pathname === '/' ) return new Response(DEMO_HTML, { headers: { 'content-type': 'text/html; charset=UTF-8', ...cors() } });
      return json({ error: 'not found', try: ['POST /verify', 'POST /ground', 'GET /'] }, 404);
    } catch (e) {
      const quota = /3040|4006|allocation|neurons|capacity/i.test(String(e));
      return json({ error: quota ? 'grader is resting (daily AI allowance reached)' : 'grader error', detail: String(e).slice(0, 200) }, 503);
    }
  },
};

const DEMO_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vouch</title>
<style>
:root{--bg:#0e0f13;--card:#171922;--ink:#e8e6e0;--mut:#8b90a0;--line:#2a2e3a;--green:#3fb98a;--grey:#8b90a0;--red:#e0685f;--accent:#e0a34e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:28px;max-width:760px;margin-inline:auto}
h1{font-size:1.5rem;margin:.2em 0}.sub{color:var(--mut);margin:0 0 1.4em}
label{display:block;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:1em 0 .35em}
textarea{width:100%;min-height:90px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:.7em .8em;font:inherit;resize:vertical}
button{margin-top:1em;background:var(--accent);color:#1a1400;border:0;border-radius:8px;padding:.7em 1.2em;font:inherit;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:progress}
.out{margin-top:1.4em;border:1px solid var(--line);border-radius:10px;padding:1em 1.1em;background:var(--card);display:none}
.badge{display:inline-block;font-weight:700;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;padding:.2em .6em;border-radius:999px}
.supported{background:rgba(63,185,138,.16);color:var(--green)}.cannot_determine{background:rgba(139,144,160,.16);color:var(--grey)}.refuted{background:rgba(224,104,95,.16);color:var(--red)}
.quote{border-left:3px solid var(--line);padding-left:.8em;margin:.8em 0;color:var(--mut)}
.rat{color:var(--mut);font-size:.92rem}
</style></head><body>
<h1>Vouch <span style="color:var(--mut);font-weight:400;font-size:1rem">grounding check</span></h1>
<p class="sub">Does the source actually support the claim? Green = yes, with the exact span. Grey = cannot tell (a first-class answer). Red = the source contradicts it.</p>
<label>Claim</label><textarea id="claim">The Tyre shekel weighed about 14 grams of high-purity silver.</textarea>
<label>Source</label><textarea id="source">Shekels of Tyre were struck in silver and are commonly cited at roughly 14 grams. They bear the head of Melqart on the obverse and an eagle on the reverse.</textarea>
<button id="go">Check</button>
<div class="out" id="out"></div>
<script>
const $=id=>document.getElementById(id);
$('go').onclick=async()=>{
  const b=$('go');b.disabled=true;b.textContent='Checking...';
  try{
    const r=await fetch('/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim:$('claim').value,source:$('source').value})});
    const d=await r.json();const o=$('out');o.style.display='block';
    const st=d.status||'cannot_determine';
    o.innerHTML='<span class="badge '+st+'">'+st.replace(/_/g,' ')+'</span> <span class="rat">conf '+(d.confidence??0).toFixed(2)+'</span>'
      +'<p class="rat">'+(d.rationale||'')+'</p>'
      +((d.anchors&&d.anchors[0])?'<div class="quote">"'+d.anchors[0].quote+'"</div>':'')
      +(d.note?'<p class="rat">note: '+d.note+'</p>':'');
  }catch(e){$('out').style.display='block';$('out').textContent='error: '+e}
  b.disabled=false;b.textContent='Check';
};
</script></body></html>`;
