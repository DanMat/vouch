# Vouch eval

Hand-labeled cases run against the live `/verify`. Re-run: `node evals/run.mjs evals/cases-v2.json <strict|fast>`.

The metric that matters most is **false-supported**: calling a claim "supported" when
the source does not actually support it. That is the failure that would make the tool
worse than useless, so it is reported first and separately.

## Results

### v2 (34 cases: coins, stamps, general; easy / hard / adversarial traps)
| slice | accuracy | **false-supported** | bad anchors |
|-------|----------|---------------------|-------------|
| 31 factual-source cases (fast) | 94% | **0** | 0 |
| 31 factual-source cases (strict) | 94% | **0** | 0 |
| + 3 sarcasm/irony probes -> full 34 (fast) | 91% | **1** (sarc03) | 0 |

By difficulty (full 34, fast): easy 5/6, hard 13/13, trap 13/15.

### v1 (15 clean cases, sanity set)
15/15 both modes, 0 false-supported.

## What the traps show
Cases designed to induce a wrong "supported" nearly all held:
- **negation** ("not perforated" vs "is perforated") -> refuted
- **role-swap** ("Rome fell to the Visigoths" vs "Visigoths were defeated at Rome") -> refuted
- **distractor-in-source** (the word "turtle" present but attributed to a different coin) -> refuted
- **numeric mismatch** (14g vs 17g) -> refuted
- **lexical-overlap** ("passed the house but rejected by the senate" vs "passed the senate") -> refuted
- **over-general / over-specific** ("high-purity" not stated; "1918" from "the 1910s") -> cannot_determine
- **gum-from-the-front, mark-not-a-cancel** (philatelic honesty) -> cannot_determine

## Known limitation: sarcasm and irony
Vouch reads sources **literally**. The sarcasm probe (3 cases) found:
- Sarcastic praise undone by an explicit qualifier ("flawless, if you ignore the tear")
  -> **refuted** (handled; the qualifier is a real fact).
- Sarcastic skepticism ("I am sure the dealer's claim is completely trustworthy")
  -> **cannot_determine** (handled; not read as confirmation).
- **Pure irony ("another rare coin that every dealer has ten of") -> supported. FAILED.**
  The grader latched onto the surface word "rare" and missed that the source implies the
  opposite. This is a genuine **false-supported**, the one dangerous failure in the set.

Honest scope: the primary sources Vouch targets (catalogue entries, museum records,
reference texts, academic papers) are almost never sarcastic, so this is an edge case for
the core product. It matters most for the reader-tool surface over opinion and social text,
where tone can invert meaning. Do not rely on Vouch for ironic or sarcastic sources.

Future mitigation (not built): a pre-check that flags likely opinion or ironic sources and
abstains (`cannot_determine`) rather than risking a literal false-support. Detecting irony
is itself hard, so abstaining on it is the honest default.

## The other two misses
- **e01, over-conservative (safe direction).** "her owl on the reverse" -> "has an owl on
  the reverse" scored `cannot_determine` in both modes. A false negative: it abstained where
  it could have supported. Annoying, not dangerous.
- **t04, label-ambiguous.** A source about a forgery that fooled experts, vs "experts
  confirmed the coin is genuine." Labeled `cannot_determine`; the grader said `refuted`. Both
  are defensible readings.

## Honest caveats
- These are **hand-built** cases, not yet a public benchmark. Next credibility layer is a
  standard set (a FEVER-style claim + evidence + label slice, where supports / refutes /
  not-enough-info map onto supported / refuted / cannot_determine).
- Small n (34 + 15). Enough to find failure modes and to show the safety property under
  adversarial pressure, not enough to quote a precise accuracy figure with confidence.
- Grader is `llama-3.3-70b` on Workers AI, swappable via `env.MODEL`. A stronger grader would
  likely lift the over-conservative recall and may catch irony better.
- Strict mode did not beat fast on accuracy here; its value is per-claim transparency
  (subclaims) and the holistic floor that blocks a decomposition-drop hole from an earlier run.

## Takeaway
On factual sources it never false-supported across 31 adversarial cases, and every failure
was in the safe (abstain) direction or on an ambiguous label. It does have one real
false-supported vulnerability, sarcasm and irony, which is documented rather than hidden and
is an edge case for the intended domains. That profile, honest about exactly where it breaks,
is the point.
