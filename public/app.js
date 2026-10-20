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
let pending = null; // a tool picked from the catalog, pre-configuring the convert

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

  renderCatalog();

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

  // apply a catalog tool's pre-configuration, if one is active
  if (pending) {
    if (pending.op === 'removebg') $('rbg').checked = true;
    if (pending.op === 'enhance') $('enh').checked = true;
    if (pending.op === 'ml' && e === 'pdf') $('ml').checked = true;
    if (pending.op === 'compress') $('q').focus();
    if (pending.to) {
      const row = [...fmtList.children].find((r) => r.querySelector('.fmt-ext')?.textContent === pending.to);
      if (row) row.click();
    }
  }
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
  pending = null;
  $('rbg').checked = $('enh').checked = false;
  if ($('ml')) $('ml').checked = false;
  $('w').value = $('q').value = '';
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

/* ---------- tool catalog (browse by need) ---------- */
// Each tool pre-configures the converter: `to` fixes the output, `op` sets an
// image operation, `url` routes to the web-page card. `tag` shows a badge.
const TOOLS = [
  {
    cat: 'popular',
    items: [
      { name: 'remove background', op: 'removebg', to: 'png', tag: 'ai', desc: '→ transparent png' },
      { name: 'pdf → word', from: 'pdf', to: 'docx', desc: 'editable document' },
      { name: 'image → jpg', to: 'jpg', desc: 'png · heic · webp · …' },
      { name: 'video → mp3', to: 'mp3', desc: 'pull the audio' },
      { name: 'web page → pdf', url: true, to: 'pdf', desc: 'any live url' },
      { name: 'compress image', op: 'compress', desc: 'smaller files' },
    ],
  },
  {
    cat: 'images',
    items: [
      { name: 'convert image', desc: 'png · jpg · webp · avif · heic · tiff …' },
      { name: 'remove background', op: 'removebg', to: 'png', tag: 'ai', desc: '→ transparent png' },
      { name: 'upscale / enhance', op: 'enhance', to: 'png', tag: 'ai', desc: 'GFPGAN faces + 2×' },
      { name: 'compress image', op: 'compress', desc: 'set quality' },
      { name: 'image → pdf', to: 'pdf', desc: 'one-page pdf' },
      { name: 'image → svg', to: 'svg', desc: 'vector trace' },
      { name: 'heic → jpg', to: 'jpg', desc: 'iphone photos' },
      { name: 'image → text', to: 'txt', tag: 'ocr', desc: 'read text from an image' },
    ],
  },
  {
    cat: 'pdf',
    items: [
      { name: 'pdf → word', from: 'pdf', to: 'docx', desc: 'editable document' },
      { name: 'pdf → word', from: 'pdf', to: 'docx', op: 'ml', tag: 'ai', desc: 'Docling high-fidelity' },
      { name: 'pdf → excel', from: 'pdf', to: 'xlsx', desc: 'extract tables' },
      { name: 'pdf → image', from: 'pdf', to: 'png', desc: 'render pages' },
      { name: 'pdf → text', from: 'pdf', to: 'txt', desc: 'plain text' },
      { name: 'word → pdf', from: 'docx', to: 'pdf', desc: 'from office' },
      { name: 'markdown → pdf', from: 'md', to: 'pdf', desc: 'from .md' },
    ],
  },
  {
    cat: 'audio & video',
    items: [
      { name: 'convert video', desc: 'mp4 · mov · webm · mkv · avi …' },
      { name: 'convert audio', desc: 'mp3 · wav · flac · ogg · m4a …' },
      { name: 'video → mp3', to: 'mp3', desc: 'extract audio' },
      { name: 'video → gif', to: 'gif', desc: 'short clips' },
      { name: 'audio → wav', to: 'wav', desc: 'uncompressed' },
    ],
  },
  {
    cat: 'documents & ebooks',
    items: [
      { name: 'convert document', desc: 'docx · odt · rtf · html · txt …' },
      { name: 'epub → mobi', from: 'epub', to: 'mobi', desc: 'kindle' },
      { name: 'pdf → epub', from: 'pdf', to: 'epub', desc: 'reflowable ebook' },
      { name: 'convert ebook', desc: 'epub · mobi · azw3 · fb2 …' },
      { name: 'markdown → docx', from: 'md', to: 'docx', desc: 'from .md' },
    ],
  },
  {
    cat: 'web & more',
    items: [
      { name: 'web page → pdf', url: true, to: 'pdf', desc: 'any live url' },
      { name: 'web page → image', url: true, to: 'png', desc: 'screenshot' },
      { name: 'convert font', desc: 'ttf · otf · woff · woff2' },
      { name: '3d model convert', desc: 'obj · stl · ply · gltf · fbx …' },
      { name: 'repack archive', desc: 'zip · 7z · tar · gz' },
    ],
  },
];

function renderCatalog() {
  const body = document.getElementById('catalogBody');
  if (!body) return;
  body.innerHTML = '';
  TOOLS.forEach((group, gi) => {
    const sec = document.createElement('div');
    sec.className = 'cat-group';
    const label = document.createElement('div');
    label.className = 'cat-label';
    label.innerHTML = `<span class="idx">${String(gi + 1).padStart(2, '0')}</span>${group.cat}`;
    sec.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'cat-grid';
    group.items.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool';
      const name = t.name.replace('→', '<span class="arrow">→</span>');
      btn.innerHTML =
        `<span class="tool-name">${name}${t.tag ? `<span class="tag">${t.tag}</span>` : ''}</span>` +
        (t.desc ? `<span class="tool-desc">${t.desc}</span>` : '');
      btn.addEventListener('click', () => selectTool(t));
      grid.appendChild(btn);
    });
    sec.appendChild(grid);
    body.appendChild(sec);
  });
}

function selectTool(t) {
  // web-page tools route to the URL card
  if (t.url) {
    const chips = $('urlFmt').querySelectorAll('.chip');
    chips.forEach((c) => c.classList.toggle('on', c.dataset.v === t.to));
    $('webcard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('url').focus();
    return;
  }
  // file tools: configure the converter, then open the file picker
  resetFile();
  pending = t;
  $('heroKicker').textContent = t.name;
  $('panelTitle').textContent = 'output';
  $('panelNote').textContent = t.to ? `→ ${t.to}` : 'drop a file';
  document.getElementById('hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
  fileInput.click(); // the tool click is a user gesture, so this is allowed
}
