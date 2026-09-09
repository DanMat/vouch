// The Grounding Protocol record, version 0. The SDK and the service both produce
// this shape; validateRecord is the reference enforcer's structural check.
//
// Verdict = { status: "supported"|"refuted"|"cannot_determine",
//             anchors: [ { source_id, quote, relation: "supports"|"refutes" } ],
//             confidence: 0..1, rationale, subclaims?: Verdict[] }
//
// GroundingRecord = { protocol, content, sources: [ { id, title? } ],
//   claims: [ { id, text, status: "sourced"|"refuted"|"abstained", anchors, confidence, rationale } ],
//   meta: { model, mode, created_at, enforcer } }

export const PROTOCOL_VERSION = '0.1';

const CLAIM_STATUS = new Set(['sourced', 'refuted', 'abstained']);

// Structural conformance: claims carry a valid status, every anchor references a
// declared source, and a "sourced" claim actually has an anchor. (Semantic checks,
// re-verifying each anchor against its source, are the enforcer's next layer.)
export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return { valid: false, errors: ['record is not an object'] };
  if (record.protocol !== PROTOCOL_VERSION) errors.push(`protocol must be "${PROTOCOL_VERSION}"`);
  const ids = new Set((record.sources || []).map((s) => s && s.id));
  for (const c of record.claims || []) {
    if (!CLAIM_STATUS.has(c.status)) errors.push(`claim ${c.id}: invalid status "${c.status}"`);
    for (const a of c.anchors || []) {
      if (!ids.has(a.source_id)) errors.push(`claim ${c.id}: anchor references undeclared source "${a.source_id}"`);
    }
    if (c.status === 'sourced' && !(c.anchors || []).length) errors.push(`claim ${c.id}: sourced but has no anchor`);
  }
  return { valid: errors.length === 0, errors };
}
