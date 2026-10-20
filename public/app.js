// Pocket Tools front-end. Vanilla, no build step.
// API base is same-origin by default; set window.POCKET_API in config.js to
// point a Vercel-hosted frontend at a backend running elsewhere.
const API = (window.POCKET_API || '').replace(/\/$/, '');

const $ = (id) => document.getElementById(id);
const RASTER = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'heif']);

const drop = $('drop');
const fileInput = $('file');
const fmtList = $('fmtList');
const goBtn = $('go');
const goText = $('goText');
const statusEl = $('status');

let conversions = {};
let chosen = null; // { file, ext }
let target = null; // selected output ext

const ext = (name) => (name.split('.').pop() || '').toLowerCase();

init();

async function init() {
  // smooth-scroll nav
  document.querySelectorAll('[data-scroll]').forEach((el) =>
    el.addEventListener('click', () => $(el.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'center' })),
  );

  try {
    const res = await fetch(`${API}/api/formats`);
    const data = await res.json();
    conversions = data.conversions || {};
    const engines = (data.engines || []).filter((e) => e.available).map((e) => e.label);
    const count = Object.values(conversions).reduce((a, b) => a + b.length, 0);
    $('engines').textContent = engines.length
      ? `${engines.length} engines · ~${count} conversions · ${engines.join(' · ').toLowerCase()}`
      : 'no engines detected';
    $('railStat').textContent = `${count}+ conversions`;
  } catch {
    $('engines').textContent = 'could not reach the server';
  }

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
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
  drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && pick(e.dataTransfer.files[0]));

  $('reset').addEventListener('click', resetFile);
  $('footReset').addEventListener('click', resetFile);
  goBtn.addEventListener('click', convert);

  // web page card
  $('urlFmt').querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      $('urlFmt').querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      c.classList.add('on');
    }),
  );
  $('urlgo').addEventListener('click', convertUrl);
  $('url').addEventListener('keydown', (e) => e.key === 'Enter' && convertUrl());
}

function pick(file) {
  const e = ext(file.name);
  chosen = { file, ext: e };
  target = null;
  $('fileName').textContent = file.name;
  $('filebar').hidden = false;
  drop.hidden = true;
  $('heroKicker').textContent = `.${e}`;
  $('heroTitle').innerHTML = `convert<span class="accent">.</span>`;
  $('panelNote').textContent = 'choose a format';
  clearStatus(statusEl);

  // move the sun up a touch as a little reaction
  document.querySelector('.sun').style.transform = 'translateX(-50%) translateY(-10px)';

  const targets = (conversions[e] || []).slice();
  if (RASTER.has(e) && !targets.includes(e)) targets.unshift(e); // same-format image ops
  renderFormats(targets, e);

  // options availability
  $('ops').hidden = false;
  $('mlopt').hidden = e !== 'pdf';
  goBtn.disabled = true;
}

function renderFormats(targets, fromExt) {
  fmtList.innerHTML = '';
  if (!targets.length) {
    const li = document.createElement('li');
    li.className = 'fmt-empty';
    li.textContent = `.${fromExt} isn't supported yet`;
    fmtList.appendChild(li);
    return;
  }
  for (const t of targets) {
    const li = document.createElement('li');
    li.className = 'fmt-row';
    const same = t === fromExt;
    li.innerHTML =
      `<span class="fmt-tick"></span><span class="fmt-ext">${t}</span>` +
      `<span class="fmt-desc">${same ? 'resize / compress' : 'convert'}</span>`;
    li.addEventListener('click', () => {
      target = t;
      [...fmtList.children].forEach((c) => c.classList.remove('sel'));
      li.classList.add('sel');
      goBtn.disabled = false;
      $('panelNote').textContent = `→ ${t}`;
    });
    fmtList.appendChild(li);
  }
}

function resetFile() {
  chosen = null;
  target = null;
  fileInput.value = '';
  $('filebar').hidden = true;
  drop.hidden = false;
  $('ops').hidden = true;
  fmtList.innerHTML = '';
  goBtn.disabled = true;
  $('heroKicker').textContent = 'any file';
  $('panelNote').textContent = 'pick a file';
  clearStatus(statusEl);
  document.querySelector('.sun').style.transform = 'translateX(-50%)';
}

function clearStatus(el) {
  el.hidden = true;
  el.className = 'status';
  el.innerHTML = '';
}
function setStatus(el, cls, html) {
  el.hidden = false;
  el.className = 'status' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
}

async function convert() {
  if (!chosen || !target) return;
  goBtn.disabled = true;
  goText.textContent = 'working';
  setStatus(statusEl, '', `uploading…<div class="bar-prog"><i></i></div>`);

  const params = new URLSearchParams({ to: target });
  const w = $('w').value.trim();
  const q = $('q').value.trim();
  if (w) params.set('width', w);
  if (q) params.set('quality', q);
  if ($('rbg').checked) params.set('removebg', '1');
  if ($('enh').checked) params.set('enhance', '1');
  if ($('ml').checked && chosen.ext === 'pdf') params.set('ml', '1');

  const form = new FormData();
  form.append('file', chosen.file, chosen.file.name);

  let job;
  try {
    const res = await fetch(`${API}/api/convert?${params}`, { method: 'POST', body: form });
    job = await res.json();
    if (!res.ok) throw new Error(job.error || 'upload failed');
  } catch (err) {
    goBtn.disabled = false;
    goText.textContent = 'convert';
    return setStatus(statusEl, 'err', `✕ ${err.message}`);
  }
  setStatus(statusEl, '', `converting via ${job.engine}…<div class="bar-prog"><i></i></div>`);
  poll(job.id, statusEl, () => {
    goBtn.disabled = false;
    goText.textContent = 'convert';
  });
}

async function convertUrl() {
  const el = $('urlStatus');
  const url = $('url').value.trim();
  if (!/^https?:\/\//i.test(url)) return setStatus(el, 'err', '✕ enter a URL starting with http(s)://');
  const to = $('urlFmt').querySelector('.chip.on')?.dataset.v || 'pdf';
  $('urlgo').disabled = true;
  setStatus(el, '', `rendering…<div class="bar-prog"><i></i></div>`);
  let job;
  try {
    const res = await fetch(`${API}/api/convert?to=${to}&url=${encodeURIComponent(url)}`, { method: 'POST' });
    job = await res.json();
    if (!res.ok) throw new Error(job.error || 'failed');
  } catch (err) {
    $('urlgo').disabled = false;
    return setStatus(el, 'err', `✕ ${err.message}`);
  }
  poll(job.id, el, () => ($('urlgo').disabled = false));
}

async function poll(id, el, done) {
  try {
    const res = await fetch(`${API}/api/jobs/${id}`);
    const job = await res.json();
    if (job.status === 'done') {
      setStatus(el, 'done', `✓ done · <a class="dl" href="${API}/api/jobs/${id}/download">download ${job.outputName} ↓</a>`);
      done && done();
      return;
    }
    if (job.status === 'error') {
      setStatus(el, 'err', `✕ ${job.error}`);
      done && done();
      return;
    }
    setTimeout(() => poll(id, el, done), 800);
  } catch {
    setStatus(el, 'err', '✕ lost connection to the server');
    done && done();
  }
}
