# The Grounding Protocol

**Version 0.1 (draft, experimental).** A portable, checkable record that
AI-generated content carries so any party can verify that each factual claim is
attributable to a stated source. It certifies **attribution** (the source supports
the claim), not world-truth.

The format may change before 1.0. Feedback welcome. Reference implementation: this
repo. Live: https://vouch.danmat.workers.dev

## 1. Scope and non-goals
In scope: checking a claim against a provided or cited source (entailment and
attribution).

Non-goals in v0: deciding real-world truth; judging opinions or predictions; finding
sources for uncited claims; and detecting sarcasm or irony (a producer SHOULD abstain
on such sources rather than interpret them).

## 2. Terminology
The keywords MUST, MUST NOT, SHOULD, and MAY are used per RFC 2119.

- **Claim** a single factual assertion.
- **Source** a document or passage a claim may be attributed to.
- **Anchor** the specific quoted span of a source that supports or refutes a claim.
- **Verdict** the result of checking one claim against sources.
- **Grounding Record** the published content plus its per-claim verdicts and sources.
- **Producer** software that generates or checks content and emits records.
- **Enforcer** software that validates a record for conformance.

## 3. Data model (normative)

### 3.1 Source
```
Source = { id: string, uri?: string, title?: string, hash?: string }
```
`id` MUST be unique within a record. `hash`, when present, lets an enforcer confirm
the source text has not changed since the record was made.

### 3.2 Anchor
```
Anchor = { source_id: string, quote: string, relation: "supports" | "refutes" }
```
`source_id` MUST match a declared Source. `quote` MUST be a verbatim substring of
that source's text, compared whitespace-insensitively. This is the extractive
guarantee: evidence cannot be invented.

### 3.3 Verdict
```
Verdict = {
  status: "supported" | "refuted" | "cannot_determine",
  anchors: Anchor[],
  confidence: number,          // 0..1
  rationale: string,
  subclaims?: Verdict[]        // present when the claim was decomposed
}
```
- **supported**: the source entails the claim. MUST include at least one anchor with
  relation `supports`.
- **refuted**: the source contradicts the claim. MUST include at least one anchor
  with relation `refutes`.
- **cannot_determine**: neither. MUST carry no anchors. This is the default whenever
  evidence is thin, ambiguous, or absent.

### 3.4 Claim (an entry in a record)
```
Claim = { id: string, text: string,
          status: "sourced" | "refuted" | "abstained",
          anchors: Anchor[], confidence: number, rationale: string }
```
A Claim is a Verdict as published in a record. The status maps from the Verdict:
`supported -> sourced`, `refuted -> refuted`, `cannot_determine -> abstained`.

### 3.5 Grounding Record
```
GroundingRecord = {
  protocol: "0.1",
  content: string,
  sources: Source[],
  claims: Claim[],
  meta: { model: string, mode: "strict" | "advisory", created_at: string, enforcer: string }
}
```

## 4. Conformance
A record is CONFORMANT when:

- **C1** `protocol` equals a version the reader supports.
- **C2** every Source has an `id` unique within the record.
- **C3** every Anchor's `source_id` matches a declared Source.
- **C4** every Anchor's `quote` is a verbatim substring of its source's text
  (whitespace-insensitive).
- **C5** a `sourced` claim has at least one `supports` anchor; a `refuted` claim has
  at least one `refutes` anchor; an `abstained` claim has no anchors.
- **C6** every factual claim carries a status. Non-factual text (reasoning,
  transitions, opinion) is not a Claim and is not required to be anchored.

C1, C2, C3, and C5 are structural and checkable without a model or the source text.
C4 is checkable against the source text. The reference enforcer (`validateRecord`)
checks C1, C2, C3, and C5 today.

## 5. Producer requirements
A conformant Producer:
- **P1** MUST NOT emit an Anchor whose quote is not verbatim in the source.
- **P2** MUST default to `cannot_determine` / `abstained` when evidence is thin or
  ambiguous.
- **P3** SHOULD apply a holistic floor: a compound claim is `supported` only if the
  whole claim and every atomic part are supported. Decomposition may only tighten a
  verdict, never upgrade one.
- **P4** SHOULD record `model` and `mode` in `meta`.

## 6. Enforcer requirements
An Enforcer takes a record, and for full checking the source texts, and reports
conformant or not with the failures.
- **E1** MUST check C1, C2, C3, and C5 (structural).
- **E2** SHOULD check C4 (quote verbatim in source) when source text is available.
- **E3** MAY re-verify entailment with its own grader (a semantic re-check).

## 7. Carrying the record (informative)
A record MAY travel as sidecar JSON, front-matter, an HTTP header, or embedded
alongside the content the way C2PA manifests ride inside a file. A downstream tool
(a CMS, a reader, another agent) can then re-verify without regenerating.

## 8. Versioning
`protocol` is a string `MAJOR.MINOR`. v0.x is experimental and may break between minor
versions. A consumer MUST reject a record whose `protocol` it does not support.

## 9. Honesty and security considerations
- **Attribution, not truth.** A conformant record built on a wrong source faithfully
  reports that the wrong source supports the claim. Sources are the caller's to trust.
- **The grader can err.** Mitigations: extractive anchors (C4 makes every verdict
  checkable), abstain-by-default, an adversarial pass, and publishing the producer's
  own eval numbers.
- **Literal reading.** Producers read sources literally and MAY be fooled by sarcasm
  or irony. They SHOULD abstain on likely-ironic sources rather than support.

## 10. Reference implementation
- Producer: `src/core.js` (`verifyClaim`, `ground`).
- Enforcer: `src/record.js` (`validateRecord`), exposed at `POST /validate`.
- Service: `worker.js` on Cloudflare Workers AI. Live at vouch.danmat.workers.dev.

## Appendix A: example record
```json
{
  "protocol": "0.1",
  "content": "The Tyre shekel weighed roughly 14 grams. [could not source: It was first minted in 126 BC.]",
  "sources": [{ "id": "ocre", "title": "OCRE" }],
  "claims": [
    { "id": "c1", "text": "The Tyre shekel weighed roughly 14 grams.", "status": "sourced",
      "anchors": [{ "source_id": "ocre", "quote": "struck in silver at roughly 14 grams", "relation": "supports" }],
      "confidence": 1, "rationale": "The source states the weight." },
    { "id": "c2", "text": "It was first minted in 126 BC.", "status": "abstained",
      "anchors": [], "confidence": 0.3, "rationale": "No source states a mint date." }
  ],
  "meta": { "model": "llama-3.3-70b", "mode": "advisory", "created_at": "2026-09-09T00:00:00Z", "enforcer": "vouch-poc/0.1" }
}
```
