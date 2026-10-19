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

function setStatus(cls, html) {
  statusEl.hidden = false;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
  statusEl.innerHTML = html;
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

async function poll(id) {
  try {
    const res = await fetch(`/api/jobs/${id}`);
    const job = await res.json();
    if (job.status === 'done') {
      setStatus(
        'done',
        `✓ Done. <a class="dl" href="/api/jobs/${id}/download">Download ${job.outputName}</a>`,
      );
      return;
    }
    if (job.status === 'error') {
      return setStatus('error', `✕ ${job.error}`);
    }
    setTimeout(() => poll(id), 800);
  } catch {
    setStatus('error', '✕ Lost connection to the server');
  }
}
