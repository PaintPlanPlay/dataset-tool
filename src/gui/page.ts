/** La page de l'interface locale : du HTML et un peu de JavaScript, rien à installer. */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dataset Tool — local interface</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.45 system-ui, sans-serif; }
  body { margin: 0; display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
  aside { border-right: 1px solid #8884; padding: 12px; overflow: auto; }
  main { padding: 16px 20px; overflow: auto; }
  input, select, textarea, button { font: inherit; }
  input[type=search] { width: 100%; box-sizing: border-box; padding: 6px 8px; }
  ul.hits { list-style: none; padding: 0; margin: 8px 0; }
  ul.hits li button { width: 100%; text-align: left; padding: 5px 6px; border: 0; background: none; cursor: pointer; }
  ul.hits li button:hover { background: #8882; }
  .kind { font-size: 11px; opacity: .65; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
  td, th { border-bottom: 1px solid #8883; padding: 4px 6px; text-align: left; vertical-align: top; }
  .origin { font-weight: 600; white-space: nowrap; }
  .origin-correction { color: #c60; } .origin-analysis { color: #a3a; } .origin-project { color: #28a; }
  pre { white-space: pre-wrap; word-break: break-word; background: #8881; padding: 8px; max-height: 260px; overflow: auto; }
  fieldset { border: 1px solid #8884; margin: 12px 0; } label { display: block; margin: 6px 0; }
  textarea { width: 100%; box-sizing: border-box; min-height: 70px; }
  .error { color: #c33; } .ok { color: #393; }
  .admin { border-bottom: 1px solid #8884; padding-bottom: 10px; margin-bottom: 12px; }
  .admin h2 { margin: 0 0 6px; font-size: 15px; }
  .admin .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
  .admin button { padding: 4px 10px; cursor: pointer; }
  .admin button:disabled { opacity: .45; cursor: not-allowed; }
  .state span { margin-right: 10px; font-size: 12px; }
  .state b { font-weight: 600; }
  .log { background: #111; color: #ddd; font: 12px/1.35 ui-monospace, monospace; padding: 8px; max-height: 220px; overflow: auto; white-space: pre-wrap; }
  .running { color: #c90; } .done { color: #393; } .failed { color: #c33; }
  /* Un clic doit se voir tout de suite : la tâche met parfois une seconde à écrire sa première ligne. */
  .admin button.busy { position: relative; opacity: 1; }
  .admin button.busy::after { content: ''; display: inline-block; width: 9px; height: 9px; margin-left: 7px; vertical-align: -1px;
    border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* Une tâche dit ce qu'elle va faire et demande son dû avant de partir. */
  dialog { border: 1px solid #8886; border-radius: 6px; padding: 16px 18px; max-width: 460px; color: inherit; background: Canvas; }
  dialog::backdrop { background: #0007; }
  dialog h3 { margin: 0 0 6px; font-size: 16px; }
  dialog .about { margin: 0 0 4px; opacity: .8; }
  dialog label { display: block; margin: 12px 0 0; font-weight: 600; }
  dialog .why { display: block; font-weight: 400; opacity: .75; margin: 3px 0 5px; }
  dialog input { width: 100%; box-sizing: border-box; padding: 5px 7px; }
  dialog .choix { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  dialog .choix button { padding: 5px 12px; cursor: pointer; }
</style>
</head>
<body>
<aside>
  <strong>Dataset Tool</strong> <span class="kind">local interface</span>
  <input type="search" id="q" placeholder="Unit, Detachment, Stratagem…" autofocus>
  <ul class="hits" id="hits"></ul>
</aside>
<main>
  <section class="admin">
    <h2>Administration</h2>
    <div class="state" id="state">…</div>
    <div class="row" id="jobs"></div>
    <pre class="log" id="log">No task started yet.</pre>
  </section>
  <dialog id="ask">
    <h3 id="ask-title"></h3>
    <p class="about" id="ask-about"></p>
    <div id="ask-fields"></div>
    <div class="choix">
      <button id="ask-no">Cancel</button>
      <button id="ask-go">Yes, do it</button>
    </div>
  </dialog>
  <div id="view"><p>Search for something to see where each of its values comes from.</p></div>
  <fieldset>
    <legend>New Correction</legend>
    <label>Army <input id="c-army"></label>
    <label>File name <input id="c-name" placeholder="boyz-points"></label>
    <label>Target <input id="c-target" size="50"></label>
    <label>Source <select id="c-source"><option>bsdata</option><option>mfm</option><option>40kdc</option></select></label>
    <label>Patch (JSON) <textarea id="c-patch">{}</textarea></label>
    <label>Upstream value (JSON) <textarea id="c-upstream">{}</textarea></label>
    <label>Reason <input id="c-reason" size="60"></label>
    <button id="c-send">Write the Correction</button> <span id="c-out"></span>
  </fieldset>
  <fieldset>
    <legend>Effect or summary written by the project</legend>
    <label>Target <input id="e-target" size="50" placeholder="&lt;unitId&gt;::ability:&lt;name&gt;"></label>
    <label>Effect (JSON, 40kdc-data format) <textarea id="e-effect"></textarea></label>
    <label>Summary (one line, never copied) <input id="e-summary" size="60"></label>
    <label>Reason <input id="e-reason" size="60"></label>
    <button id="e-send">Write</button> <span id="e-out"></span>
  </fieldset>
  <fieldset>
    <legend>Back to the Upstream Source</legend>
    <label>Correction <input id="u-path" size="60" placeholder="corrections/wh40k-11e/orks/…json"></label>
    <button id="u-draft">Draft an issue</button>
    <label>PR or issue you opened <input id="u-url" size="60"></label>
    <button id="u-send">Save it on the Correction</button> <span id="u-out"></span>
  </fieldset>
</main>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error + (data.findings && data.findings.length ? ' — ' + data.findings.join(' ; ') : ''));
  return data;
}
let lastTarget = null;
let lastValue = null;
const report = (out, promise) => { out.className = ''; out.textContent = 'writing…'; return promise.then(async (r) => { out.className = 'ok'; const base = (r.pullRequest || r.path || 'ok') + (r.prCommands ? '  ·  PR: ' + r.prCommands.join(' && ') : ''); out.textContent = base + '  ·  re-reading the Dataset…';
    // La fiche ouverte doit montrer ce qu'on vient d'écrire, sans rien recharger à la main.
    await api('/api/refresh', {});
    await refreshState();
    if (lastTarget) await show(lastTarget);
    out.textContent = base; })
  .catch((e) => { out.className = 'error'; out.textContent = e.message; }); };
// ------------------------------------------------------------ administration
let jobTimer = null;
let logCursor = 0;
let logOuvert = false;

async function refreshState() {
  const d = await api('/api/state');
  const s = d.state;
  const mark = (ok, label) => '<span><b>' + (ok ? '✔' : '—') + '</b> ' + label + '</span>';
  $('state').innerHTML =
    mark(s.dataset, 'Dataset') +
    mark(s.snapshot, 'snapshot') +
    mark(s.published, s.armies ? s.armies + ' Armies' : 'built') +
    mark(s.provenance, 'value origins') +
    mark(d.allowPush, 'remote writes') +
    mark(d.gh, 'GitHub CLI');
  const jobs = $('jobs');
  jobs.replaceChildren();
  for (const j of d.jobs) {
    const b = el('button', j.label);
    b.title = j.blocked || j.hint;
    b.disabled = Boolean(j.blocked);
    b.dataset.job = j.name;
    b.onclick = () => demander(j);
    jobs.append(b);
  }
}

/*
 * Un bouton dit d'abord ce qu'il va faire, et ne demande que ce dont il a
 * besoin. Trois champs posés en permanence au-dessus du journal n'apprenaient
 * rien à personne : on ne devine pas qu'il faut nommer une période de règles.
 */
function demander(job) {
  const dlg = $('ask');
  $('ask-title').textContent = job.label;
  $('ask-about').textContent = job.hint;
  const boite = $('ask-fields');
  boite.replaceChildren();
  const entrees = [];
  for (const f of job.asks || []) {
    const lab = el('label', f.label);
    const champ = document.createElement('input');
    champ.value = f.value || '';
    lab.append(el('span', f.hint, 'why'), champ);
    boite.append(lab);
    entrees.push([f.name, champ]);
  }
  $('ask-no').onclick = () => dlg.close();
  $('ask-go').onclick = () => {
    const valeurs = {};
    for (const paire of entrees) valeurs[paire[0]] = paire[1].value.trim();
    dlg.close();
    runJob(job.name, valeurs);
  };
  dlg.showModal();
}

async function runJob(name, valeurs) {
  logCursor = 0;
  logOuvert = false;
  // Le clic doit se voir avant même que le serveur réponde : sinon on croit
  // avoir manqué le bouton, et on reclique.
  const boutons = Array.from($('jobs').querySelectorAll('button'));
  for (const b of boutons) { b.disabled = true; if (b.dataset.job === name) b.classList.add('busy'); }
  $('log').textContent = 'starting…';
  try {
    await api('/api/jobs/' + name, valeurs || {});
  } catch (e) {
    $('log').textContent = e.message;
    await refreshState();
    return;
  }
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = setInterval(pollJob, 900);
  pollJob();
}

async function pollJob() {
  const d = await api('/api/jobs?since=' + logCursor);
  if (!d.job) return;
  logCursor = d.next;
  const log = $('log');
  if (d.lines.length) {
    // La première ligne chasse le « starting… », les suivantes s'y ajoutent.
    if (!logOuvert) { log.textContent = ''; logOuvert = true; }
    log.textContent += d.lines.join('\\n') + '\\n';
  }
  log.scrollTop = log.scrollHeight;
  if (d.job.state !== 'running') {
    clearInterval(jobTimer);
    jobTimer = null;
    // La tâche a pu changer ce qu'on lit : on relit le dossier, puis l'état.
    await api('/api/refresh', {});
    await refreshState();
  }
}

refreshState().catch((e) => { $('state').textContent = e.message; });

let timer;
$('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
  const hits = await api('/api/search?q=' + encodeURIComponent($('q').value));
  const list = $('hits'); list.replaceChildren();
  for (const h of hits) { const li = el('li'); const b = el('button'); b.append(el('div', h.name), el('div', h.kind + ' · ' + h.army, 'kind')); b.onclick = () => show(h.target); li.append(b); list.append(li); }
}, 200); });
async function show(target) {
  lastTarget = target;
  const view = $('view');
  try {
    const d = await api('/api/inspect?target=' + encodeURIComponent(target));
    view.replaceChildren(el('h2', d.name), el('div', d.kind + ' · ' + d.army + ' · ' + d.target, 'kind'));
    const table = el('table'); table.append((() => { const tr = el('tr'); tr.append(el('th', 'Field'), el('th', 'Origin'), el('th', 'Detail')); return tr; })());
    for (const o of d.origins) { const tr = el('tr'); tr.append(el('td', o.field), el('td', o.origin, 'origin origin-' + o.origin), el('td', o.detail || '')); table.append(tr); }
    view.append(table);
    if (d.corrections.length) { view.append(el('h3', 'Corrections')); for (const c of d.corrections) view.append(el('div', c.state + ' · ' + c.path + ' — ' + c.note)); }
    if (d.proposals.length) {
      view.append(el('h3', 'Suggestions from the ability analysis'));
      for (const p of d.proposals) { const box = el('div'); const b = el('button', 'Accept'); const out = el('span'); b.onclick = () => report(out, api('/api/proposals/accept', { target: p.target })); box.append(el('strong', p.ability + ' '), b, out, el('pre', JSON.stringify(p.effect, null, 2))); view.append(box); }
    }
    view.append(el('h3', 'Published value'), el('pre', JSON.stringify(d.value, null, 2)));
    $('c-army').value = d.army; $('c-target').value = d.target; $('e-target').value = d.target;
    lastValue = d.value;
    $('c-patch').value = '{}';
    $('c-upstream').value = '{}';
  } catch (e) { view.replaceChildren(el('p', e.message, 'error')); }
}
$('c-send').onclick = () => { let patch, upstream; try { patch = JSON.parse($('c-patch').value || '{}'); upstream = JSON.parse($('c-upstream').value || '{}'); } catch { $('c-out').textContent = 'Invalid JSON'; return; }
  // Sans valeur amont, la Correction naît « en conflit » : on la remplit avec ce
  // que la fiche affiche aujourd'hui, champ par champ, quand elle est laissée vide.
  if (lastValue && !Object.keys(upstream).length) { upstream = {}; for (const k of Object.keys(patch)) if (k in lastValue) upstream[k] = lastValue[k]; }
  report($('c-out'), api('/api/corrections', { army: $('c-army').value, name: $('c-name').value, correction: { target: $('c-target').value, source: $('c-source').value, patch, upstream, reason: $('c-reason').value } })); };
$('e-send').onclick = () => { const body = { target: $('e-target').value, reason: $('e-reason').value };
  if ($('e-effect').value.trim()) { try { body.effect = JSON.parse($('e-effect').value); } catch { $('e-out').textContent = 'Invalid JSON'; return; } }
  if ($('e-summary').value.trim()) body.summary = $('e-summary').value;
  report($('e-out'), api('/api/effects', body)); };
$('u-draft').onclick = async () => { try { const d = await api('/api/upstream-draft?path=' + encodeURIComponent($('u-path').value)); window.open(d.url, '_blank', 'noopener'); } catch (e) { $('u-out').className = 'error'; $('u-out').textContent = e.message; } };
$('u-send').onclick = () => report($('u-out'), api('/api/corrections/upstream-pr', { path: $('u-path').value, url: $('u-url').value }));
</script>
</body>
</html>
`;
