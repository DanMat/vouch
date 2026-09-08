# Pitch: ground PhilatelyOS stamp write-ups with Vouch

You are building an engine that talks about individual stamps. The moment an LLM
writes about a stamp, it will happily assert plausible-but-unsourced facts: a
catalogue number it never saw, a date it guessed, or "never hinged" read off a
front-only photo. In a reference product, one fabricated fact costs the trust of
the whole catalogue. Vouch closes that at the source.

## What Vouch is
A grounding check for AI claims. It answers one question: does the source actually
support this claim? Verdict plus the exact supporting span, and an honest "cannot
determine" when the source does not say. It certifies attribution (the source backs
the claim), not world-truth. Live PoC: https://vouch.danmat.workers.dev

## Why it fits PhilatelyOS specifically
It enforces the philatelic-literacy discipline you already hold:
- "cannot determine" is a first-class result, not a failure. Gum state from the
  front, a faint mark that might not be a cancel, souvenir-vs-miniature sheet from a
  photo: Vouch abstains instead of guessing.
- It refuses fabricated catalogue numbers and attributions by construction. A claim
  is only "supported" if a real span of a real source entails it, and the service
  verifies the quoted span is actually present in the source before it will say so.
- Compound claims are decomposed, so "an 1840 Penny Black in never-hinged condition"
  is checked as separate facts, and the half you cannot source does not ride along on
  the half you can.

## Two ways to use it (pick either or both)
1. **Gate each generated statement** with `POST /verify {claim, source}` where
   `source` is that stamp's catalogue or reference entry. Render `supported` claims
   with their citation, show `cannot_determine` as "not yet established," and drop or
   flag `refuted`.
2. **Generate the whole blurb grounded** with `POST /ground {prompt, sources[]}`.
   It writes strictly from the sources you pass and returns a record where
   unsourceable claims are marked, not asserted.

## Shapes
```
POST /verify   { "claim": "...", "source": "...", "mode": "strict" | "fast" }
  -> { "status": "supported"|"refuted"|"cannot_determine",
       "anchors": [ { "source_id", "quote", "relation" } ],
       "confidence": 0..1, "rationale": "...",
       "subclaims": [ ...same shape per atomic fact... ] }   // when it decomposed

POST /ground   { "prompt": "...", "sources": [ { "id": "scott", "text": "..." } ] }
  -> { "content": "...unsourceable parts marked...",
       "claims": [ { "text", "status", "anchors", "confidence" } ], ... }
```

## Python (it is just HTTP, so language does not matter)
```python
import requests

VOUCH = "https://vouch.danmat.workers.dev"

def check(claim, source):
    r = requests.post(f"{VOUCH}/verify", json={"claim": claim, "source": source}, timeout=120)
    return r.json()

# gate a generated sentence about a stamp against its catalogue entry
v = check(
    "The Penny Black was issued in Britain in 1840.",
    catalogue_entry_text_for_this_stamp,
)
if v["status"] == "supported":
    render(sentence, cite=v["anchors"][0]["quote"])
elif v["status"] == "refuted":
    drop(sentence)          # the source contradicts it
else:
    mark_unestablished(sentence)   # honest grey, do not assert
```

Or generate the whole thing grounded:
```python
rec = requests.post(f"{VOUCH}/ground", json={
    "prompt": "Describe this stamp: issue, design, and condition.",
    "sources": [{"id": "scott", "text": scott_entry}, {"id": "photo_notes", "text": observed_notes}],
}, timeout=120).json()
publish(rec["content"])   # unsourceable claims already marked
```

## Honest caveats
- Early PoC. The API may change; a Python SDK can follow if the HTTP path proves out.
- Grader runs on Cloudflare Workers AI (model swappable); a stronger grader raises
  quality. The loop and the record are the point.
- It verifies attribution, not truth. If your catalogue entry itself is wrong, Vouch
  will faithfully report that the (wrong) source supports the claim. Sources are yours
  to trust.

## The ask
Wire the stamp engine's factual output through Vouch before it ships, either gating
per claim or generating grounded. Then tell me where it is too strict, too lenient,
or too slow. You are the first real dogfood, and your catalogue corpus is exactly the
hard, honesty-sensitive domain the protocol needs to prove itself on.
