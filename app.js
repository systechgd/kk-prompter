/* KodeKatta Prompter: teleprompter + camera/voice recorder.
   Runs fully in the browser. Nothing is uploaded; scripts and settings live in this device's localStorage. */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------- storage (never trust it to exist) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('kk.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kk.' + k, JSON.stringify(v)); } catch {} },
};

const DEFAULTS = {
  speed: 46, size: 34, height: 45, dim: 72, autoScroll: true, countdownOn: true, mirrorText: false,
  showMarks: true, noiseSup: true, mode: 'video', facing: 'user', q: 1080,
  frame: 'wide', fit: 'contain', zoom: 0, lens: '',   // wide = full sensor (3:4), no crop; zoom 0 = widest
};
const S = Object.assign({}, DEFAULTS, store.get('settings', {}));
const saveSettings = () => store.set('settings', S);

const SAMPLE = {
  id: 'sample', title: 'How to use (sample)', text:
`**🔊 START READING**

_(smile: this is a tone cue, don't read it aloud)_
Hi, / this is the **KodeKatta** prompter. //
Words in **colour** / are the ones to **stress**. /
A small slash / is a short pause. //
Two slashes / are a long pause. //
_(curious)_
Tap the text / to pause or play the scroll. /
Drag it / to move up or down. //
Press the **red** button / to record. //

**🔇 STOP READING**` };

let lib = store.get('library', null);
if (!Array.isArray(lib) || !lib.length) lib = [SAMPLE];
let currentId = store.get('current', lib[0].id);
const saveLib = () => { store.set('library', lib); store.set('current', currentId); };

// ---------- script parsing (our READING-MARKS format) ----------
function extractReading(raw) {
  const lines = raw.replace(/\r/g, '').split('\n');
  const a = lines.findIndex((l) => /START READING/i.test(l));
  const b = lines.findIndex((l, i) => i > a && /STOP READING/i.test(l));
  let body = a >= 0 ? lines.slice(a + 1, b > a ? b : undefined) : lines;
  return body.map((l) => l.replace(/^\s*>\s?/, '')).join('\n').trim();
}
function titleFrom(raw, fallback) {
  const m = raw.match(/^#\s+(.+)$/m);
  return (m ? m[1] : fallback || 'Untitled').replace(/[*_`]/g, '').trim().slice(0, 80);
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function renderLine(line) {
  let h = esc(line);
  h = h.replace(/_\(([^)]*)\)_/g, '<span class="cue">($1)</span>');            // tone cue
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');                               // stress
  h = h.replace(/(^|\s)\/\/(?=\s|$)/g, '$1<span class="p2">‖</span>');          // long pause
  h = h.replace(/(^|\s)\/(?=\s|$)/g, '$1<span class="p1">/</span>');            // short pause
  return h;
}
function renderScript(raw) {
  const body = extractReading(raw);
  const out = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) { out.push('<div class="gap"></div>'); continue; }
    if (/^\s*_\([^)]*\)_\s*$/.test(line)) { out.push(renderLine(line.trim())); continue; }
    out.push('<p>' + renderLine(line.trim()) + '</p>');
  }
  out.push('<p class="endmark">■ END: stop recording</p>');
  return out.join('');
}

// ---------- UI refs ----------
const video = $('#preview'), textEl = $('#text'), scroller = $('#scroller'), prompter = $('#prompter');
const btnRec = $('#btnRec'), btnScroll = $('#btnScroll');

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function openSheet(id) { $$('.sheet').forEach((s) => s.classList.toggle('open', s.id === id)); }
function closeSheets() { $$('.sheet').forEach((s) => s.classList.remove('open')); }
$$('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));

// ---------- apply settings ----------
function applySettings() {
  const r = document.documentElement.style;
  r.setProperty('--size', S.size + 'px');
  r.setProperty('--height', S.height + 'vh');
  r.setProperty('--dim', (S.dim / 100).toFixed(2));
  prompter.classList.toggle('mirror', S.mirrorText);
  textEl.classList.toggle('nomarks', !S.showMarks);
  for (const k of ['speed', 'size', 'height', 'dim']) { $('#' + k).value = S[k]; }
  $('#oSpeed').textContent = S.speed; $('#oSize').textContent = S.size + 'px';
  $('#oHeight').textContent = S.height + '%'; $('#oDim').textContent = S.dim + '%';
  for (const k of ['autoScroll', 'countdownOn', 'mirrorText', 'showMarks', 'noiseSup']) $('#' + k).checked = !!S[k];
  $$('[data-set-mode]').forEach((b) => b.classList.toggle('on', b.dataset.setMode === S.mode));
  $$('[data-facing]').forEach((b) => b.classList.toggle('on', b.dataset.facing === S.facing));
  $$('[data-q]').forEach((b) => b.classList.toggle('on', +b.dataset.q === S.q));
  $$('[data-frame]').forEach((b) => b.classList.toggle('on', b.dataset.frame === S.frame));
  $$('[data-fit]').forEach((b) => b.classList.toggle('on', b.dataset.fit === S.fit));
  video.classList.toggle('back', S.facing === 'environment');
  video.classList.toggle('fill', S.fit === 'cover');
}
for (const k of ['speed', 'size', 'height', 'dim']) {
  $('#' + k).addEventListener('input', (e) => { S[k] = +e.target.value; applySettings(); saveSettings(); });
}
for (const k of ['autoScroll', 'countdownOn', 'mirrorText', 'showMarks']) {
  $('#' + k).addEventListener('change', (e) => { S[k] = e.target.checked; applySettings(); saveSettings(); });
}
$('#noiseSup').addEventListener('change', (e) => { S.noiseSup = e.target.checked; saveSettings(); restartMedia(); });
$$('[data-set-mode]').forEach((b) => b.addEventListener('click', () => { S.mode = b.dataset.setMode; saveSettings(); applySettings(); restartMedia(); }));
$$('[data-facing]').forEach((b) => b.addEventListener('click', () => { S.facing = b.dataset.facing; S.lens = ''; S.zoom = 0; saveSettings(); applySettings(); restartMedia(); }));
$$('[data-frame]').forEach((b) => b.addEventListener('click', () => { S.frame = b.dataset.frame; saveSettings(); applySettings(); restartMedia(); }));
$$('[data-fit]').forEach((b) => b.addEventListener('click', () => { S.fit = b.dataset.fit; saveSettings(); applySettings(); }));
$('#lens').addEventListener('change', (e) => { S.lens = e.target.value; S.zoom = 0; saveSettings(); restartMedia(); });
$('#zoom').addEventListener('input', (e) => {
  S.zoom = +e.target.value; saveSettings(); $('#oZoom').textContent = S.zoom.toFixed(1) + '×';
  const vt = stream && stream.getVideoTracks()[0];
  if (vt) vt.applyConstraints({ advanced: [{ zoom: S.zoom }] }).catch(() => {});
});
$$('[data-q]').forEach((b) => b.addEventListener('click', () => { S.q = +b.dataset.q; saveSettings(); applySettings(); restartMedia(); }));
$('#btnSettings').addEventListener('click', () => openSheet('settings'));

// ---------- library ----------
function current() { return lib.find((s) => s.id === currentId) || lib[0]; }
function loadCurrent() {
  textEl.innerHTML = renderScript(current().text);
  setPos(0); take = 1; updateTake();
}
function renderLib() {
  const ul = $('#lib'); ul.innerHTML = '';
  for (const s of lib) {
    const li = document.createElement('li'); li.className = s.id === currentId ? 'on' : '';
    const words = extractReading(s.text).replace(/_\([^)]*\)_|\*\*|\/\/|\s\/\s/g, ' ').split(/\s+/).filter(Boolean).length;
    li.innerHTML = `<span>${esc(s.title)}<small>${words} words · ~${Math.round(words / 2.4)} s</small></span>`;
    const del = document.createElement('button'); del.textContent = '🗑️'; del.title = 'Delete';
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirmInline(del)) return;
      lib = lib.filter((x) => x.id !== s.id); if (!lib.length) lib = [SAMPLE];
      if (currentId === s.id) currentId = lib[0].id;
      saveLib(); renderLib(); loadCurrent();
    };
    li.onclick = () => { currentId = s.id; saveLib(); renderLib(); loadCurrent(); closeSheets(); };
    li.appendChild(del); ul.appendChild(li);
  }
}
// two-tap delete (no browser confirm dialogs)
function confirmInline(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; btn.textContent = 'Delete?';
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = '🗑️'; }, 2500);
  return false;
}
function addScript(title, text) {
  const id = 's' + Date.now();
  lib.unshift({ id, title, text }); currentId = id; saveLib(); renderLib(); loadCurrent();
}
$('#btnScripts').addEventListener('click', () => { renderLib(); openSheet('scripts'); });
$('#btnPaste').addEventListener('click', () => { $('#pasteBox').hidden = !$('#pasteBox').hidden; });
$('#btnSavePaste').addEventListener('click', () => {
  const text = $('#pasteText').value; if (!text.trim()) return toast('Paste a script first');
  addScript($('#pasteTitle').value.trim() || titleFrom(text, 'Pasted script'), text);
  $('#pasteText').value = ''; $('#pasteTitle').value = ''; $('#pasteBox').hidden = true; closeSheets();
  toast('Script saved');
});
$('#fileIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  addScript(titleFrom(text, f.name.replace(/\.(md|txt)$/i, '')), text);
  e.target.value = ''; closeSheets(); toast('Loaded: ' + current().title);
});

// ---------- scrolling ----------
let pos = 0, scrolling = false, lastT = 0;
function maxPos() { return Math.max(0, textEl.scrollHeight - prompter.clientHeight * 0.35); }
function setPos(p) { pos = Math.min(Math.max(0, p), maxPos()); textEl.style.transform = `translateY(${-pos}px)`; }
function tick(t) {
  if (!scrolling) return;
  const dt = lastT ? (t - lastT) / 1000 : 0; lastT = t;
  setPos(pos + S.speed * dt * (S.size / 34));          // speed scales with text size so reading pace stays the same
  if (pos >= maxPos()) { setScroll(false); return; }
  requestAnimationFrame(tick);
}
function setScroll(on) {
  scrolling = on; lastT = 0; btnScroll.firstChild.textContent = on ? '⏸' : '▶';
  if (on) requestAnimationFrame(tick);
}
btnScroll.addEventListener('click', () => setScroll(!scrolling));
$('#btnRestart').addEventListener('click', () => { setScroll(false); setPos(0); });

// tap = play/pause, drag = move text
let drag = null;
prompter.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, p: pos, moved: false, was: scrolling }; setScroll(false); });
prompter.addEventListener('pointermove', (e) => {
  if (!drag) return; const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 6) drag.moved = true;
  if (drag.moved) setPos(drag.p - dy);
});
const endDrag = () => { if (!drag) return; if (!drag.moved) setScroll(!drag.was); drag = null; };
prompter.addEventListener('pointerup', endDrag); prompter.addEventListener('pointercancel', endDrag);
prompter.addEventListener('wheel', (e) => { setPos(pos + e.deltaY); }, { passive: true });

// keyboard (laptop): space = scroll, R = record, arrows = speed
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); setScroll(!scrolling); }
  else if (e.key === 'r' || e.key === 'R') toggleRecord();
  else if (e.key === 'ArrowUp') { S.speed = Math.min(160, S.speed + 4); applySettings(); saveSettings(); }
  else if (e.key === 'ArrowDown') { S.speed = Math.max(10, S.speed - 4); applySettings(); saveSettings(); }
  else if (e.key === 'Home') setPos(0);
});

// ---------- media ----------
let stream = null, audioCtx = null, analyser = null, wakeLock = null, noMic = false;
function friendly(e, what) {
  const name = what === 'mic' ? 'microphone' : 'camera';
  switch (e && e.name) {
    case 'NotFoundError': case 'OverconstrainedError':
      return `No ${name} found. Plug one in (earphones with a mic work), or turn it on in Windows Settings → System → Sound / Bluetooth & devices.`;
    case 'NotReadableError': case 'AbortError':
      return `The ${name} is busy or blocked. Close other apps using it (Zoom, Teams, Camera, WhatsApp, OBS), and check Windows Settings → Privacy & security → ${what === 'mic' ? 'Microphone' : 'Camera'} → allow desktop apps.`;
    case 'NotAllowedError': case 'SecurityError':
      return `Access to the ${name} was denied. Click the camera/lock icon in the address bar → Allow, then try again.`;
    default: return `${name}: ${e && e.message ? e.message : e}`;
  }
}
async function startMedia() {
  stopMedia();
  const audio = { echoCancellation: false, noiseSuppression: !!S.noiseSup, autoGainControl: false, channelCount: 1 };
  const v = S.mode === 'video' ? videoConstraints() : false;
  noMic = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio, video: v });
  } catch (err) {
    if (v && S.lens) { S.lens = ''; saveSettings(); return startMedia(); }   // chosen lens gone: fall back to front/back
    // find out which device failed, so we can say exactly what to fix
    let audioErr = null, videoErr = null;
    try { (await navigator.mediaDevices.getUserMedia({ audio })).getTracks().forEach((t) => t.stop()); } catch (e) { audioErr = e; }
    if (v) { try { (await navigator.mediaDevices.getUserMedia({ video: v })).getTracks().forEach((t) => t.stop()); } catch (e) { videoErr = e; } }
    if (v && audioErr && !videoErr) {                       // camera works, mic doesn't: open camera, warn
      stream = await navigator.mediaDevices.getUserMedia({ video: v });
      noMic = true;
      toast('⚠️ ' + friendly(audioErr, 'mic') + ' Recordings will have NO sound.', 7000);
    } else {
      throw new Error([audioErr && friendly(audioErr, 'mic'), videoErr && friendly(videoErr, 'camera')].filter(Boolean).join(' ') || friendly(err, v ? 'camera' : 'mic'));
    }
  }
  if (v) { video.srcObject = stream; video.hidden = false; $('#audioView').hidden = true; await video.play().catch(() => {}); }
  else { video.srcObject = null; video.hidden = true; $('#audioView').hidden = false; }
  startMeter(); keepAwake();
  const vt = stream.getVideoTracks()[0];
  if (vt) { await tuneCamera(vt); listLenses(); }
  const st = vt && vt.getSettings();
  $('#devInfo').textContent = (st ? `Camera: ${st.width}×${st.height} @ ${Math.round(st.frameRate || 30)}fps · ` : '') +
    `Mic: ${noMic ? 'NONE (no sound!)' : (stream.getAudioTracks()[0]?.label || 'default')} · Format: ${pickMime().type || 'browser default'}`;
}
// Phone camera sizes are landscape (e.g. 1440x1080); the browser rotates them to portrait by itself.
// Asking for a portrait size made the browser crop + upscale = "auto zoom" and a blurry picture.
// resizeMode 'none' = use a real camera mode, never crop/scale.
function videoConstraints() {
  const short = S.q, long = Math.round(S.q * (S.frame === 'wide' ? 4 / 3 : 16 / 9));
  const c = { width: { ideal: long }, height: { ideal: short }, frameRate: { ideal: 30 }, resizeMode: { ideal: 'none' }, zoom: true };
  if (S.lens) c.deviceId = { exact: S.lens }; else c.facingMode = S.facing;
  return c;
}
// zoom out to the widest view (or the saved zoom) and keep focus/exposure automatic, where the phone allows it
async function tuneCamera(vt) {
  const caps = vt.getCapabilities ? vt.getCapabilities() : {};
  const z = caps.zoom, row = $('#zoomRow'), adv = {};
  if (z && z.max > z.min) {
    const want = S.zoom >= z.min && S.zoom <= z.max ? S.zoom : z.min;
    adv.zoom = want; row.hidden = false;
    const inp = $('#zoom'); inp.min = z.min; inp.max = z.max; inp.step = z.step || 0.1; inp.value = want;
    $('#oZoom').textContent = (+want).toFixed(1) + '×';
  } else row.hidden = true;
  for (const k of ['focusMode', 'exposureMode', 'whiteBalanceMode']) {
    if (caps[k] && caps[k].includes('continuous')) adv[k] = 'continuous';
  }
  if (Object.keys(adv).length) await vt.applyConstraints({ advanced: [adv] }).catch(() => {});
}
// some phones have 2+ lenses (normal / wide); let the user pick
async function listLenses() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('#lens'); $('#lensRow').hidden = cams.length < 2;
    sel.innerHTML = '<option value="">Auto (' + (S.facing === 'user' ? 'front' : 'back') + ')</option>' +
      cams.map((c, i) => `<option value="${esc(c.deviceId)}">${esc(c.label || 'Camera ' + (i + 1))}</option>`).join('');
    sel.value = S.lens;
  } catch {}
}
function stopMedia() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }
async function restartMedia() {
  if (recorder && recorder.state === 'recording') return toast('Stop recording first');
  try { await startMedia(); } catch (e) { toast('⚠️ ' + e.message, 8000); }
}
function startMeter() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const loop = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(buf);
      let peak = 0; for (const x of buf) peak = Math.max(peak, Math.abs(x - 128));
      const w = Math.min(100, (peak / 128) * 160) + '%';
      $('#meter').style.width = w; $('#meterBig').style.width = w;
      $('#meter').style.background = $('#meterBig').style.background = peak > 120 ? 'var(--red)' : 'var(--terminal)';
      requestAnimationFrame(loop);
    };
    loop();
  } catch {}
}
async function keepAwake() {
  try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && stream) keepAwake(); });

// ---------- recording ----------
function pickMime() {
  const v = S.mode === 'video';
  const list = v
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const type = list.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const ext = type.includes('mp4') ? (v ? 'mp4' : 'm4a') : 'webm';
  return { type, ext };
}
let recorder = null, chunks = [], recStart = 0, clockT = null, take = 1, lastBlob = null, lastName = '';
function updateTake() { $('#take').textContent = 'Take ' + take; }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'script';

async function countdown() {
  if (!S.countdownOn) return;
  const c = $('#countdown'); c.hidden = false;
  for (const n of [3, 2, 1]) { c.textContent = n; await new Promise((r) => setTimeout(r, 800)); }
  c.hidden = true;
}
async function toggleRecord() {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  if (!stream) { try { await startMedia(); } catch (e) { return toast('Allow camera/mic first: ' + e.message, 5000); } }
  setScroll(false); setPos(0);
  await countdown();
  const { type, ext } = pickMime();
  const opts = { audioBitsPerSecond: 192000 }; if (type) opts.mimeType = type;
  if (S.mode === 'video') {                         // bitrate from the real camera size (~0.2 bits per pixel)
    const st = stream.getVideoTracks()[0]?.getSettings() || {};
    const px = (st.width || 1920) * (st.height || 1080) * (st.frameRate || 30);
    opts.videoBitsPerSecond = Math.min(20000000, Math.max(6000000, Math.round(px * 0.2)));
  }
  try { recorder = new MediaRecorder(stream, opts); }
  catch { recorder = new MediaRecorder(stream); }
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = () => onStopped(ext);
  recorder.start(1000);
  recStart = Date.now(); btnRec.classList.add('on'); $('#rec').hidden = false;
  clockT = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $('#clock').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 250);
  if (S.autoScroll) setTimeout(() => { if (recorder && recorder.state === 'recording') setScroll(true); }, 900);
}
btnRec.addEventListener('click', toggleRecord);

function onStopped(ext) {
  clearInterval(clockT); btnRec.classList.remove('on'); $('#rec').hidden = true; setScroll(false);
  const type = recorder.mimeType || chunks[0]?.type || (S.mode === 'video' ? 'video/webm' : 'audio/webm');
  lastBlob = new Blob(chunks, { type });
  const d = new Date(), stamp = d.toISOString().slice(0, 10) + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  lastName = `kk-${slug(current().title)}-${S.mode === 'video' ? 'video' : 'voice'}-take${take}-${stamp}.${ext}`;
  const url = URL.createObjectURL(lastBlob);
  const isV = S.mode === 'video';
  $('#resVideo').hidden = !isV; $('#resAudio').hidden = isV;
  (isV ? $('#resVideo') : $('#resAudio')).src = url;
  $('#btnDownload').href = url; $('#btnDownload').download = lastName;
  const secs = Math.round((Date.now() - recStart) / 1000);
  $('#resTitle').textContent = `Take ${take} · ${secs}s`;
  $('#resInfo').textContent = `${lastName} · ${(lastBlob.size / 1048576).toFixed(1)} MB. Save it, then send it to the laptop (Drive / WhatsApp / cable) into the episode's voice/ folder.`;
  $('#btnShare').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([lastBlob], lastName, { type })] })) && !window.showSaveFilePicker;
  openSheet('result');
}
$('#btnShare').addEventListener('click', async () => {
  if (!lastBlob) return;
  const file = new File([lastBlob], lastName, { type: lastBlob.type });
  try {
    if (window.showSaveFilePicker && !/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      const h = await showSaveFilePicker({ suggestedName: lastName });
      const w = await h.createWritable(); await w.write(lastBlob); await w.close();
      toast('Saved ✓'); return;
    }
    await navigator.share({ files: [file], title: lastName });
  } catch (e) { if (e.name !== 'AbortError') toast('Use Download instead: ' + e.message, 4000); }
});
$('#btnDiscard').addEventListener('click', () => { lastBlob = null; take++; updateTake(); closeSheets(); setPos(0); });
$('#btnDownload').addEventListener('click', () => { setTimeout(() => { take++; updateTake(); }, 300); });

// ---------- start ----------
$$('#start [data-mode]').forEach((b) => b.addEventListener('click', async () => {
  S.mode = b.dataset.mode; saveSettings(); applySettings();
  if (!navigator.mediaDevices?.getUserMedia) {
    $('#startMsg').textContent = 'This browser cannot use the camera here. Open the app from its https:// link (or localhost on the laptop) in Chrome or Safari.';
    return;
  }
  try { await startMedia(); closeSheets(); toast('Tip: tap the text to play/pause, drag to move'); }
  catch (e) { $('#startMsg').textContent = '⚠️ ' + e.message; }
}));

applySettings(); loadCurrent();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
