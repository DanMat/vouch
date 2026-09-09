// Vouch core: the model-agnostic grounding engine. No platform dependencies.
// Callers inject `model`, an async function (messages) => string | object, so the
// same engine runs behind a Cloudflare Worker, a Node SDK, or any other backend.

import { norm, quoteIsInSource, asVerdict, asText, firstArray } from './util.js';
import { VERIFY_SYSTEM, DECOMPOSE_SYSTEM, ADVERSARIAL_SYSTEM, GROUND_SYSTEM } from './prompts.js';
import { PROTOCOL_VERSION } from './record.js';

const say = (system, user) => [{ role: 'system', content: system }, { role: 'user', content: user }];

// The atomic primitive: verify one already-atomic claim against one source string.
export async function verifyAtomic(model, claim, source, sourceId = 's1') {
  const raw = await model(say(VERIFY_SYSTEM, `SOURCE:\n"""\n${source}\n"""\n\nCLAIM:\n"""\n${claim}\n"""`));
  const parsed = asVerdict(raw);
  let status = ['supported', 'refuted', 'cannot_determine'].includes(parsed.status) ? parsed.status : 'cannot_determine';
  const quote = typeof parsed.quote === 'string' ? parsed.quote : '';
  let confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
  const rationale = norm(parsed.rationale) || 'No rationale returned.';

  // Extractive guarantee: a supported/refuted verdict MUST quote real source text.
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

// Break a compound claim into atomic sub-claims. Falls back to the whole claim.
export async function decompose(model, claim) {
  try {
    const arr = firstArray(await model(say(DECOMPOSE_SYSTEM, `CLAIM:\n${claim}`)));
    const atoms = (arr || []).map((s) => norm(s)).filter((s) => s.length > 8).slice(0, 6);
    return atoms.length ? atoms : [claim];
  } catch { return [claim]; }
}

// Second opinion: try to knock down a "supported" verdict. True if it holds.
export async function adversarialHolds(model, claim, source, quote) {
  try {
    const p = asVerdict(await model(say(ADVERSARIAL_SYSTEM, `SOURCE:\n"""\n${source}\n"""\n\nCLAIM:\n${claim}\n\nQUOTE:\n${quote}`)));
    return p.holds !== false; // default to holding unless it clearly says false
  } catch { return true; }
}

// Full check: holistic floor + decomposition that can only tighten. A claim is
// supported only if the whole claim AND every atom pass; refuted if any is refuted.
export async function verifyClaim(model, claim, source, sourceId = 's1', opts = {}) {
  const doDecompose = opts.decompose !== false;
  const doAdv = opts.adversarial !== false;

  const withAdversarial = async (a, v) => {
    if (doAdv && v.status === 'supported') {
      const holds = await adversarialHolds(model, a, source, v.anchors[0]?.quote || '');
      if (!holds) return { status: 'cannot_determine', anchors: [], confidence: Math.min(v.confidence, 0.45), rationale: v.rationale, note: 'downgraded by adversarial pass' };
    }
    return v;
  };

  const whole = await withAdversarial(claim, await verifyAtomic(model, claim, source, sourceId));

  const subs = [];
  if (doDecompose) {
    const atoms = await decompose(model, claim);
    if (atoms.length > 1) {
      for (const a of atoms) subs.push({ text: a, ...(await withAdversarial(a, await verifyAtomic(model, a, source, sourceId))) });
    }
  }

  const anyRefuted = whole.status === 'refuted' || subs.some((s) => s.status === 'refuted');
  const allSupported = whole.status === 'supported' && subs.every((s) => s.status === 'supported');
  const status = anyRefuted ? 'refuted' : allSupported ? 'supported' : 'cannot_determine';

  const anchors = [...(whole.anchors || []), ...subs.flatMap((s) => s.anchors || [])];
  const confidence = Math.min(whole.confidence ?? 0.5, ...subs.map((s) => s.confidence ?? 0.5), 1);
  const rationale = status === 'supported'
    ? 'The whole claim and each of its parts are supported by the source.'
    : status === 'refuted'
      ? 'Contradicted by the source: ' + ((subs.find((s) => s.status === 'refuted') || whole).rationale || '')
      : 'Not every part of the claim could be grounded in the source.';
  return { status, anchors, confidence, rationale, ...(subs.length ? { subclaims: subs } : {}) };
}

// Split generated prose into candidate factual claims (one per sentence for the PoC).
export function toClaims(text) {
  return norm(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// Born-grounded generation: write from the sources, then verify every claim and
// build the record. Unsupported claims are marked, not asserted.
export async function ground(model, prompt, sources, opts = {}) {
  const srcBlock = sources.map((s, i) => `[${s.id || 's' + (i + 1)}] ${s.text}`).join('\n\n');
  const draft = await model(say(GROUND_SYSTEM, `SOURCES:\n"""\n${srcBlock}\n"""\n\nQUESTION:\n${prompt}`));

  const claims = [];
  const groundedParts = [];
  for (const text of toClaims(asText(draft))) {
    let best = { status: 'cannot_determine', anchors: [], confidence: 0.3, rationale: 'No source supports this.' };
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const v = await verifyAtomic(model, text, s.text, s.id || 's' + (i + 1));
      if (v.status === 'supported' || v.status === 'refuted') { best = v; break; }
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
    meta: { model: opts.modelName || 'unknown', mode: 'advisory', created_at: new Date().toISOString(), enforcer: `vouch-poc/${PROTOCOL_VERSION}` },
  };
}
