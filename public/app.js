// OpenConvert front-end. Vanilla, no build step.
const $ = (id) => document.getElementById(id);
const drop = $('drop');
const fileInput = $('file');
const panel = $('panel');
const fileName = $('file-name');
const toSelect = $('to');
const goBtn = $('go');
const statusEl = $('status');

let conversions = {};
let chosen = null; // { file, ext }

const ext = (name) => (name.split('.').pop() || '').toLowerCase();

init();

async function init() {
  try {
    const res = await fetch('/api/formats');
    const data = await res.json();
    conversions = data.conversions || {};
    const engines = (data.engines || []).filter((e) => e.available).map((e) => e.label);
    $('engines').textContent = engines.length ? `engines: ${engines.join(' · ')}` : 'no engines detected';
  } catch {
    $('engines').textContent = 'could not reach server';
  }

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => fileInput.files[0] && pick(fileInput.files[0]));

  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('drag');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
    }),
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) pick(f);
  });

  $('reset').addEventListener('click', resetAll);
  toSelect.addEventListener('change', () => (goBtn.disabled = !toSelect.value));
  goBtn.addEventListener('click', convert);

  $('urlgo').addEventListener('click', convertUrl);
  $('url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') convertUrl();
  });
}

function pick(file) {
  const e = ext(file.name);
  chosen = { file, ext: e };
  fileName.textContent = file.name;
  drop.hidden = true;
  panel.hidden = false;
  statusEl.hidden = true;
  statusEl.className = 'status';
  statusEl.innerHTML = '';

  const targets = conversions[e] || [];
  toSelect.innerHTML = '';
  if (!targets.length) {
    toSelect.disabled = true;
    goBtn.disabled = true;
    const opt = document.createElement('option');
    opt.textContent = `.${e} not supported`;
    toSelect.appendChild(opt);
    return;
  }
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'choose format…';
  toSelect.appendChild(ph);
  for (const t of targets) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.toUpperCase();
    toSelect.appendChild(opt);
  }
  toSelect.disabled = false;
  goBtn.disabled = true;
}

function resetAll() {
  chosen = null;
  fileInput.value = '';
  panel.hidden = true;
  drop.hidden = false;
}

function setStatusOn(el, cls, html) {
  el.hidden = false;
  el.className = 'status' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
}
function setStatus(cls, html) {
  setStatusOn(statusEl, cls, html);
}

async function convertUrl() {
  const url = $('url').value.trim();
  const el = $('urlstatus');
  if (!/^https?:\/\//i.test(url)) return setStatusOn(el, 'error', '✕ Enter a URL starting with http:// or https://');
  const to = $('urlto').value;
  $('urlgo').disabled = true;
  setStatusOn(el, '', `Rendering…<div class="bar"><i></i></div>`);
  let job;
  try {
    const res = await fetch(`/api/convert?to=${to}&url=${encodeURIComponent(url)}`, { method: 'POST' });
    job = await res.json();
    if (!res.ok) throw new Error(job.error || 'Failed');
  } catch (err) {
    $('urlgo').disabled = false;
    return setStatusOn(el, 'error', `✕ ${err.message}`);
  }
  poll(job.id, el);
  $('urlgo').disabled = false;
}

async function convert() {
  if (!chosen || !toSelect.value) return;
  goBtn.disabled = true;
  toSelect.disabled = true;
  setStatus('', 'Uploading…<div class="bar"><i></i></div>');

  const form = new FormData();
  form.append('file', chosen.file, chosen.file.name);

  let job;
  try {
    const res = await fetch(`/api/convert?to=${encodeURIComponent(toSelect.value)}`, {
      method: 'POST',
      body: form,
    });
    job = await res.json();
    if (!res.ok) throw new Error(job.error || 'Upload failed');
  } catch (err) {
    return setStatus('error', `✕ ${err.message}`);
  }

  setStatus('', `Converting with ${job.engine}…<div class="bar"><i></i></div>`);
  poll(job.id);
}

async function poll(id, el = statusEl) {
  try {
    const res = await fetch(`/api/jobs/${id}`);
    const job = await res.json();
    if (job.status === 'done') {
      setStatusOn(el, 'done', `✓ Done. <a class="dl" href="/api/jobs/${id}/download">Download ${job.outputName}</a>`);
      return;
    }
    if (job.status === 'error') {
      return setStatusOn(el, 'error', `✕ ${job.error}`);
    }
    setTimeout(() => poll(id, el), 800);
  } catch {
    setStatusOn(el, 'error', '✕ Lost connection to the server');
  }
}
