// Run a labeled eval against the live /verify and report metrics with breakdowns.
//   node evals/run.mjs [casesFile] [mode]
//   node evals/run.mjs evals/cases-v2.json strict
import fs from 'node:fs';

const CASES = process.argv[2] || new URL('./cases.json', import.meta.url).pathname;
const MODE = process.argv[3] || 'strict';
const ENDPOINT = process.env.VOUCH_URL || 'https://vouch.danmat.workers.dev/verify';
const cases = JSON.parse(fs.readFileSync(CASES, 'utf8'));

const pct = (x) => `${(100 * x).toFixed(0)}%`;
const results = [];
for (const c of cases) {
  let d;
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim: c.claim, source: c.source, mode: MODE }) });
    d = await r.json();
  } catch (e) { d = { status: 'error', detail: String(e) }; }
  if (d.error || d.status === 'error') { console.log(`ERR  ${c.id} (${d.error || d.detail})`); results.push({ ...c, got: 'error', ok: false, anchorReal: true }); if (/allowance|neurons|resting/i.test(JSON.stringify(d))) { console.log('>>> budget exhausted, stopping'); break; } continue; }
  const got = d.status;
  const ok = got === c.expect;
  const anchorReal = (d.anchors || []).every((a) => c.source.toLowerCase().replace(/\s+/g, ' ').includes((a.quote || '').toLowerCase().replace(/\s+/g, ' ')));
  results.push({ ...c, got, ok, anchorReal });
  console.log(`${ok ? 'ok  ' : 'MISS'} ${c.id.padEnd(5)} ${c.diff.padEnd(5)} ${c.cat.padEnd(22)} expect=${c.expect.padEnd(17)} got=${got}`);
}

const done = results.filter((r) => r.got !== 'error');
const n = done.length, correct = done.filter((r) => r.ok).length;
const labels = ['supported', 'refuted', 'cannot_determine'];
const prec = (l) => { const g = done.filter((r) => r.got === l); return g.length ? g.filter((r) => r.ok).length / g.length : 1; };
const rec = (l) => { const e = done.filter((r) => r.expect === l); return e.length ? e.filter((r) => r.ok).length / e.length : 1; };
const byGroup = (key) => { const m = {}; for (const r of done) { (m[r[key]] ??= []).push(r); } return Object.entries(m).map(([k, v]) => [k, v.filter((x) => x.ok).length, v.length]); };
const falseSupported = done.filter((r) => r.got === 'supported' && r.expect !== 'supported');
const badAnchor = done.filter((r) => !r.anchorReal);

console.log(`\n=== ${CASES.split('/').pop()}  mode=${MODE}  (${n} scored) ===`);
console.log(`Accuracy: ${correct}/${n} = ${pct(correct / n)}`);
for (const l of labels) console.log(`  ${l.padEnd(17)} precision ${pct(prec(l))}  recall ${pct(rec(l))}`);
console.log(`\nby difficulty:`); byGroup('diff').forEach(([k, c2, t]) => console.log(`  ${k.padEnd(6)} ${c2}/${t}`));
console.log(`\n** FALSE-SUPPORTED (the dangerous failure): ${falseSupported.length} **`);
falseSupported.forEach((r) => console.log(`   ${r.id} [${r.cat}] "${r.claim}"`));
console.log(`Anchors not verbatim in source: ${badAnchor.length}`);
const misses = done.filter((r) => !r.ok);
if (misses.length) { console.log(`\nAll misses (${misses.length}):`); misses.forEach((r) => console.log(`  ${r.id} [${r.cat}] expected ${r.expect}, got ${r.got}`)); }
