# Vouch eval

Hand-labeled cases run against the live `/verify`. Re-run: `node evals/run.mjs evals/cases-v2.json <strict|fast>`.

The metric that matters most is **false-supported**: calling a claim "supported" when
the source does not actually support it. That is the failure that would make the tool
worse than useless, so it is reported first and separately.

## Results

### v2 (31 cases: coins, stamps, general; easy / hard / adversarial traps)
| mode | accuracy | supported P/R | refuted P/R | cannot_determine P/R | **false-supported** | bad anchors |
|------|----------|---------------|-------------|----------------------|---------------------|-------------|
| fast (single-shot) | 29/31 = 94% | 100% / 86% | 93% / 100% | 91% / 91% | **0** | 0 |
| strict (decompose + adversarial + floor) | 29/31 = 94% | 100% / 86% | 93% / 100% | 91% / 91% | **0** | 0 |

By difficulty (both modes): easy 5/6, hard 13/13, trap 11/12.

### v1 (15 clean cases, sanity set)
15/15 both modes, 0 false-supported.

## What the traps show
Cases designed to induce a wrong "supported" all held:
- **negation** ("not perforated" vs "is perforated") -> refuted
- **role-swap** ("Rome fell to the Visigoths" vs "Visigoths were defeated at Rome") -> refuted
- **distractor-in-source** (the word "turtle" present but attributed to a different coin) -> refuted
- **numeric mismatch** (14g vs 17g) -> refuted
- **lexical-overlap** ("bill passed the house but rejected by the senate" vs "passed the senate") -> refuted
- **over-general / over-specific** ("high-purity" not stated; "1918" from "the 1910s") -> cannot_determine
- **gum-from-the-front, mark-not-a-cancel** (philatelic honesty) -> cannot_determine

## The two misses (honest)
- **e01, over-conservative (safe direction).** "her owl on the reverse" -> "has an owl on
  the reverse" was scored `cannot_determine` in both modes. A false negative: it abstained
  where it could have supported. Annoying, not dangerous. Suggests the 70b grader is
  sometimes too strict on plain paraphrases; tuning the prompt could help but must not be
  allowed to open the false-supported door.
- **t04, label-ambiguous.** A source about a forgery that fooled experts, vs the claim
  "experts confirmed the coin is genuine." Labeled `cannot_determine`; the grader said
  `refuted`. Both are defensible readings, so this is a labeling judgment, not a clear miss.

## Honest caveats
- These are **hand-built** cases, not yet a public benchmark. The next credibility layer is
  a standard set (a FEVER-style claim + evidence + label slice, where supports / refutes /
  not-enough-info map straight onto supported / refuted / cannot_determine).
- Small n (31). Enough to find failure modes and to show the safety property holds under
  adversarial pressure, not enough to quote a precise accuracy figure with confidence.
- Grader is `llama-3.3-70b` on Workers AI, swappable via `env.MODEL`; a stronger grader
  would likely lift the over-conservative recall.
- On this set, strict mode did not beat fast on accuracy. Its value is the per-claim
  transparency (subclaims) and the holistic floor that blocks a decomposition-drop hole
  found in an earlier run, not a headline number.

## Takeaway
Zero false-supported across 46 cases including hand-crafted traps, with every failure in
the safe (abstain) direction or on a genuinely ambiguous label. That is exactly the profile
an honesty-first grounding check should have: when unsure, it abstains; it does not invent
support, and it never accepts evidence it cannot quote.
