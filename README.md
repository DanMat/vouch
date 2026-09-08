# Vouch (PoC)

Phase 1 proof of concept of the Grounding Protocol: a code-enforced grounding check
for AI-generated claims. See `../danmat.dev-site/drafts/vouch-spec.md` for the spec.

- `POST /verify {claim, source}` -> Verdict (supported | refuted | cannot_determine)
  with an extractive anchor. The grader must quote real source text; the code checks
  the quote is a real substring before accepting a verdict.
- `POST /ground {prompt, sources:[{id,text}]}` -> a GroundingRecord: content plus a
  per-claim verdict, with unsourceable claims marked instead of asserted.
- `GET /` -> a paste-and-see demo.

Runs on Cloudflare Workers AI (grader model swappable via `env.MODEL`).
