export const DEMO_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vouch</title>
<style>
:root{--bg:#0e0f13;--card:#171922;--ink:#e8e6e0;--mut:#8b90a0;--line:#2a2e3a;--green:#3fb98a;--grey:#8b90a0;--red:#e0685f;--accent:#e0a34e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:28px;max-width:760px;margin-inline:auto}
h1{font-size:1.5rem;margin:.2em 0}.sub{color:var(--mut);margin:0 0 1.4em}
label{display:block;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:1em 0 .35em}
textarea{width:100%;min-height:90px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:.7em .8em;font:inherit;resize:vertical}
button{margin-top:1em;background:var(--accent);color:#1a1400;border:0;border-radius:8px;padding:.7em 1.2em;font:inherit;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:progress}
.out{margin-top:1.4em;border:1px solid var(--line);border-radius:10px;padding:1em 1.1em;background:var(--card);display:none}
.badge{display:inline-block;font-weight:700;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;padding:.2em .6em;border-radius:999px}
.supported{background:rgba(63,185,138,.16);color:var(--green)}.cannot_determine{background:rgba(139,144,160,.16);color:var(--grey)}.refuted{background:rgba(224,104,95,.16);color:var(--red)}
.quote{border-left:3px solid var(--line);padding-left:.8em;margin:.8em 0;color:var(--mut)}
.rat{color:var(--mut);font-size:.92rem}
</style></head><body>
<h1>Vouch <span style="color:var(--mut);font-weight:400;font-size:1rem">grounding check</span></h1>
<p class="sub">Does the source actually support the claim? Green = yes, with the exact span. Grey = cannot tell (a first-class answer). Red = the source contradicts it.</p>
<label>Claim</label><textarea id="claim">The Tyre shekel was struck in silver at roughly 14 grams.</textarea>
<label>Source</label><textarea id="source">Shekels of Tyre were struck in silver and are commonly cited at roughly 14 grams. They bear the head of Melqart on the obverse and an eagle on the reverse.</textarea>
<button id="go">Check</button>
<div class="out" id="out"></div>
<script>
const $=id=>document.getElementById(id);
$('go').onclick=async()=>{
  const b=$('go');b.disabled=true;b.textContent='Checking...';
  try{
    const r=await fetch('/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim:$('claim').value,source:$('source').value})});
    const d=await r.json();const o=$('out');o.style.display='block';
    const st=d.status||'cannot_determine';
    o.innerHTML='<span class="badge '+st+'">'+st.replace(/_/g,' ')+'</span> <span class="rat">conf '+(d.confidence??0).toFixed(2)+'</span>'
      +'<p class="rat">'+(d.rationale||'')+'</p>'
      +((d.anchors&&d.anchors[0])?'<div class="quote">"'+d.anchors[0].quote+'"</div>':'')
      +(d.note?'<p class="rat">note: '+d.note+'</p>':'');
  }catch(e){$('out').style.display='block';$('out').textContent='error: '+e}
  b.disabled=false;b.textContent='Check';
};
</script></body></html>`;
