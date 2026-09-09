// Small pure helpers shared by the core. No platform dependencies.

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Is `quote` really present in `source` (whitespace-insensitive)? The extractive
// guarantee: a supported/refuted verdict must quote text that is actually there.
export function quoteIsInSource(quote, source) {
  const q = norm(quote).toLowerCase();
  if (q.length < 4) return false;
  return norm(source).toLowerCase().includes(q);
}

export function firstJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function firstArray(raw) {
  if (Array.isArray(raw)) return raw;
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Workers AI (and other backends) return `.response` as a string for some models
// and an already-parsed object for others. Normalise both.
export const asVerdict = (raw) => (raw && typeof raw === 'object' ? raw : firstJson(raw) || {});
export const asText = (raw) => (typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''));
