/** La page de l'interface locale : du HTML et un peu de JavaScript, rien à installer. */
export const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dataset Tool — interface locale</title>
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
</style>
</head>
<body>
<aside>
  <strong>Dataset Tool</strong> <span class="kind">interface locale</span>
  <input type="search" id="q" placeholder="Unit, Detachment, Stratagem…" autofocus>
  <ul class="hits" id="hits"></ul>
</aside>
<main>
  <section class="admin">
    <h2>Administration</h2>
    <div class="state" id="state">…</div>
    <div class="row" id="jobs"></div>
    <div class="row">
      <label>Dataslate <input id="j-dataslate" size="10" placeholder="mfm-1-4"></label>
      <label>Adresse des Releases <input id="j-url" size="38" placeholder="https://cdn.jsdelivr.net/gh/…@{tag}/"></label>
      <label>Titre de PR <input id="j-title" size="22" placeholder="Modifications du Dataset"></label>
    </div>
    <pre class="log" id="log">Aucune tâche lancée.</pre>
  </section>
  <div id="view"><p>Cherchez un élément pour voir d'où vient chaque valeur.</p></div>
  <fieldset>
    <legend>Nouvelle Correction</legend>
    <label>Army <input id="c-army"></label>
    <label>Nom du fichier <input id="c-name" placeholder="boyz-points"></label>
    <label>Cible <input id="c-target" size="50"></label>
    <label>Source <select id="c-source"><option>bsdata</option><option>mfm</option><option>40kdc</option></select></label>
    <label>Patch (JSON) <textarea id="c-patch">{}</textarea></label>
    <label>Valeur amont (JSON) <textarea id="c-upstream">{}</textarea></label>
    <label>Raison <input id="c-reason" size="60"></label>
    <button id="c-send">Écrire la Correction</button> <span id="c-out"></span>
  </fieldset>
  <fieldset>
    <legend>Effect ou résumé écrit par le projet</legend>
    <label>Cible <input id="e-target" size="50" placeholder="&lt;unitId&gt;::ability:&lt;nom&gt;"></label>
    <label>Effect (JSON, format 40kdc-data) <textarea id="e-effect"></textarea></label>
    <label>Résumé (une ligne, jamais recopiée) <input id="e-summary" size="60"></label>
    <label>Raison <input id="e-reason" size="60"></label>
    <button id="e-send">Écrire</button> <span id="e-out"></span>
  </fieldset>
  <fieldset>
    <legend>Retour à l'Upstream Source</legend>
    <label>Correction <input id="u-path" size="60" placeholder="corrections/wh40k-11e/orks/…json"></label>
    <button id="u-draft">Préparer une issue</button>
    <label>PR ou issue ouverte <input id="u-url" size="60"></label>
    <button id="u-send">Enregistrer sur la Correction</button> <span id="u-out"></span>
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
const report = (out, promise) => { out.className = ''; out.textContent = 'écriture…'; return promise.then(async (r) => { out.className = 'ok'; const base = (r.pullRequest || r.path || 'ok') + (r.prCommands ? '  ·  PR : ' + r.prCommands.join(' && ') : ''); out.textContent = base + '  ·  relecture du Dataset…';
    // La fiche ouverte doit montrer ce qu'on vient d'écrire, sans rien recharger à la main.
    await api('/api/refresh', {});
    await refreshState();
    if (lastTarget) await show(lastTarget);
    out.textContent = base; })
  .catch((e) => { out.className = 'error'; out.textContent = e.message; }); };
// ------------------------------------------------------------ administration
let jobTimer = null;
let logCursor = 0;

async function refreshState() {
  const d = await api('/api/state');
  const s = d.state;
  const mark = (ok, label) => '<span><b>' + (ok ? '✔' : '—') + '</b> ' + label + '</span>';
  if (d.releaseUrl && !$('j-url').value) $('j-url').value = d.releaseUrl;
  $('state').innerHTML =
    mark(s.dataset, 'Dataset') +
    mark(s.snapshot, 'instantané') +
    mark(s.published, s.armies ? s.armies + ' Armies' : 'construit') +
    mark(s.provenance, 'origine des valeurs') +
    mark(d.allowPush, 'écriture distante');
  const jobs = $('jobs');
  jobs.replaceChildren();
  for (const j of d.jobs) {
    const b = el('button', j.label);
    b.title = j.blocked || j.hint;
    b.disabled = Boolean(j.blocked);
    b.onclick = () => runJob(j.name);
    jobs.append(b);
  }
}

async function runJob(name) {
  logCursor = 0;
  $('log').textContent = '';
  try {
    await api('/api/jobs/' + name, {
      dataslate: $('j-dataslate').value.trim(),
      releaseUrl: $('j-url').value.trim(),
      title: $('j-title').value.trim(),
    });
  } catch (e) {
    $('log').textContent = e.message;
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
  if (d.lines.length) log.textContent += d.lines.join('\\n') + '\\n';
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
    const table = el('table'); table.append((() => { const tr = el('tr'); tr.append(el('th', 'Champ'), el('th', 'Origine'), el('th', 'Détail')); return tr; })());
    for (const o of d.origins) { const tr = el('tr'); tr.append(el('td', o.field), el('td', o.origin, 'origin origin-' + o.origin), el('td', o.detail || '')); table.append(tr); }
    view.append(table);
    if (d.corrections.length) { view.append(el('h3', 'Corrections')); for (const c of d.corrections) view.append(el('div', c.state + ' · ' + c.path + ' — ' + c.note)); }
    if (d.proposals.length) {
      view.append(el('h3', "Propositions de l'analyse d'aptitudes"));
      for (const p of d.proposals) { const box = el('div'); const b = el('button', 'Accepter'); const out = el('span'); b.onclick = () => report(out, api('/api/proposals/accept', { target: p.target })); box.append(el('strong', p.ability + ' '), b, out, el('pre', JSON.stringify(p.effect, null, 2))); view.append(box); }
    }
    view.append(el('h3', 'Valeur publiée'), el('pre', JSON.stringify(d.value, null, 2)));
    $('c-army').value = d.army; $('c-target').value = d.target; $('e-target').value = d.target;
    lastValue = d.value;
    $('c-patch').value = '{}';
    $('c-upstream').value = '{}';
  } catch (e) { view.replaceChildren(el('p', e.message, 'error')); }
}
$('c-send').onclick = () => { let patch, upstream; try { patch = JSON.parse($('c-patch').value || '{}'); upstream = JSON.parse($('c-upstream').value || '{}'); } catch { $('c-out').textContent = 'JSON invalide'; return; }
  // Sans valeur amont, la Correction naît « en conflit » : on la remplit avec ce
  // que la fiche affiche aujourd'hui, champ par champ, quand elle est laissée vide.
  if (lastValue && !Object.keys(upstream).length) { upstream = {}; for (const k of Object.keys(patch)) if (k in lastValue) upstream[k] = lastValue[k]; }
  report($('c-out'), api('/api/corrections', { army: $('c-army').value, name: $('c-name').value, correction: { target: $('c-target').value, source: $('c-source').value, patch, upstream, reason: $('c-reason').value } })); };
$('e-send').onclick = () => { const body = { target: $('e-target').value, reason: $('e-reason').value };
  if ($('e-effect').value.trim()) { try { body.effect = JSON.parse($('e-effect').value); } catch { $('e-out').textContent = 'JSON invalide'; return; } }
  if ($('e-summary').value.trim()) body.summary = $('e-summary').value;
  report($('e-out'), api('/api/effects', body)); };
$('u-draft').onclick = async () => { try { const d = await api('/api/upstream-draft?path=' + encodeURIComponent($('u-path').value)); window.open(d.url, '_blank', 'noopener'); } catch (e) { $('u-out').className = 'error'; $('u-out').textContent = e.message; } };
$('u-send').onclick = () => report($('u-out'), api('/api/corrections/upstream-pr', { path: $('u-path').value, url: $('u-url').value }));
</script>
</body>
</html>
`;
