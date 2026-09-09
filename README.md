# Vouch

A code-enforced grounding check for AI-generated claims, and the seed of the
**Grounding Protocol**. It answers one question about any claim: does the source it
cites actually support it? Verdict, the exact supporting span, and an honest "cannot
determine" when the source does not say. It certifies attribution, not world-truth.

Spec: `../danmat.dev-site/drafts/vouch-spec.md`. Live PoC: https://vouch.danmat.workers.dev

## Layout
The engine is a portable, model-agnostic core; the Cloudflare Worker is a thin
adapter. Same core will back a Node SDK and (ported) a Python SDK.

- `src/core.js` — the engine: `verifyClaim`, `verifyAtomic`, `decompose`,
  `adversarialHolds`, `ground`, `toClaims`. Takes an injected `model` function
  `(messages) => string | object`, so it has no platform dependency.
- `src/record.js` — `PROTOCOL_VERSION` and the `GroundingRecord` / `Verdict` shapes,
  plus `validateRecord` (the reference enforcer's structural conformance check).
- `src/prompts.js` — the grader prompts (verify, decompose, adversarial, ground).
- `src/util.js` — pure helpers, including the extractive `quoteIsInSource` guard.
- `src/demo.js` — the paste-and-see demo page.
- `worker.js` — injects a Workers AI backend (with a fallback model) and serves:
  - `POST /verify {claim, source, mode?}` -> Verdict. `mode:"fast"` skips decomposition
    and the adversarial pass; default is strict.
  - `POST /ground {prompt, sources:[{id,text}]}` -> a GroundingRecord (unsourceable
    claims marked, not asserted).
  - `POST /validate {record}` -> structural conformance result.
  - `GET /` -> the demo.

## Guarantees
- **Extractive:** a supported/refuted verdict must quote real source text; the code
  checks the quote is a substring before accepting it. The grader cannot invent
  evidence.
- **Abstain by default:** thin or ambiguous evidence returns `cannot_determine`.
- **Holistic floor:** a claim is supported only if the whole claim AND every atom
  pass, so decomposition can only tighten a verdict, never launder a bad one.

## Eval
`evals/EVAL.md` has the honest results. 46 hand-labeled cases; 0 false-supported on
the 31 factual-source cases; the one false-supported is a documented sarcasm/irony
edge. Re-run: `node evals/run.mjs evals/cases-v2.json <strict|fast>`.

## Develop
Grader model is swappable via `env.MODEL` (default llama-3.3-70b on Workers AI).
Deploy with wrangler. MIT.
