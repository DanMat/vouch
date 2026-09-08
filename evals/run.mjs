// Run the labeled eval against the live /verify and report metrics.
import fs from 'node:fs';
const ENDPOINT = process.env.VOUCH_URL || 'https://vouch.danmat.workers.dev/verify';
const cases = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));

const results = [];
for (const c of cases) {
  const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim: c.claim, source: c.source }) });
  const d = await r.json();
  const got = d.status || 'error';
  const ok = got === c.expect;
  const anchorReal = (d.anchors || []).every((a) => c.source.toLowerCase().replace(/\s+/g, ' ').includes((a.quote || '').toLowerCase().replace(/\s+/g, ' ')));
  results.push({ ...c, got, ok, anchors: (d.anchors || []).length, anchorReal });
  console.log(`${ok ? 'ok  ' : 'MISS'} ${c.id.padEnd(12)} expect=${c.expect.padEnd(17)} got=${got}`);
}

const n = results.length, correct = results.filter((r) => r.ok).length;
const lab = ['supported', 'refuted', 'cannot_determine'];
const prec = (l) => { const got = results.filter((r) => r.got === l); const tp = got.filter((r) => r.ok).length; return got.length ? (tp / got.length) : 1; };
const rec = (l) => { const exp = results.filter((r) => r.expect === l); const tp = exp.filter((r) => r.ok).length; return exp.length ? (tp / exp.length) : 1; };
// The dangerous failure: calling something "supported" that is not truly supported.
const falseSupported = results.filter((r) => r.got === 'supported' && r.expect !== 'supported');
const badAnchor = results.filter((r) => !r.anchorReal);

console.log(`\nAccuracy: ${correct}/${n} = ${(100 * correct / n).toFixed(0)}%`);
for (const l of lab) console.log(`  ${l.padEnd(17)} precision ${(100 * prec(l)).toFixed(0)}%  recall ${(100 * rec(l)).toFixed(0)}%`);
console.log(`\nFALSE-SUPPORTED (the dangerous case): ${falseSupported.length}  ${falseSupported.map((r) => r.id).join(', ')}`);
console.log(`Anchors not verbatim in source: ${badAnchor.length}`);
if (correct < n) console.log('\nMisses:'), results.filter((r) => !r.ok).forEach((r) => console.log(`  ${r.id}: expected ${r.expect}, got ${r.got}`));
