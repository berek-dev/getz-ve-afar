// Prototype page: examples, AI chat (Claude, when the page runs as an artifact), cut list, drawing
// and JSON paste. The 3D view is the shared viewer (src/viewer3d/viewer.js), inlined before this by
// scripts/build-3d-prototype.ts, so createViewer is in scope.
const C = window.GVA_CORE;
const EXAMPLES = window.GVA_EXAMPLES;
const INSTRUCTIONS = C.LAYOUT_INSTRUCTIONS;
const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------------------------- state
const STORE = 'gva3d.mine';
const state = {
  key: null,
  raw: null,
  prepared: null,
  cut: null,
  mode: 'new', // 'new' = describe a job, 'edit' = change the current model
  requests: [],
  undo: [],
  open: 0,
  dims: true,
  under: false,
};
function loadMine() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    return s && s.raw ? s : null;
  } catch {
    return null;
  }
}
function saveMine() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ raw: state.raw, requests: state.requests, undo: state.undo.slice(-5) }));
  } catch {
    /* private mode: fine */
  }
}

// --------------------------------------------------------------------------------------------- viewer
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const viewer = createViewer($('view'), {
  core: C,
  onPick(info) {
    $('info').hidden = !info;
    if (info) $('info-text').innerHTML = `${info.mark ? `<b>${info.mark}</b> ` : ''}${esc(info.text)}`;
  },
  onOpenChange(t) {
    state.open = t;
    $('open').value = String(Math.round(t * 100));
    $('open-btn').textContent = t > 0.5 ? 'סגור' : 'פתח';
  },
});
$('info-close').onclick = () => viewer.clearSelection();
$('placeholder').remove();

// ------------------------------------------------------------------------------------------- toolbar
// ------------------------------------------------------------------------------------------- toolbar
$('open').addEventListener('input', (e) => viewer.setOpen(Number(e.target.value) / 100));
$('open-btn').onclick = () => viewer.animateOpen(state.open > 0.5 ? 0 : 1);
$('t-dims').onclick = (e) => {
  state.dims = !state.dims;
  viewer.setDims(state.dims);
  e.currentTarget.setAttribute('aria-pressed', String(state.dims));
};
$('t-front').onclick = () => viewer.frame('front');
$('t-reset').onclick = () => viewer.frame('3d');
$('t-under').onclick = (e) => {
  state.under = !state.under;
  viewer.setUnderground(state.under);
  e.currentTarget.setAttribute('aria-pressed', String(state.under));
};
$('t-full').onclick = () => {
  const stage = $('stage');
  const on = !stage.classList.contains('is-full');
  stage.classList.toggle('is-full', on);
  document.body.classList.toggle('no-scroll', on);
  $('t-full-label').textContent = on ? 'יציאה' : 'מסך מלא';
  try {
    if (on && stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch {
    /* the in-page layer is enough */
  }
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('stage').classList.contains('is-full')) $('t-full').click();
});

// ------------------------------------------------------------------------------------- page content
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

function renderInfo() {
  const { scene: sc, warnings } = state.prepared;
  const cut = state.cut;
  $('title').textContent = sc.title;
  const pieces = cut.pieces.reduce((s, p) => s + p.count, 0);
  $('summary').textContent = `${pieces} חלקי פרופיל, ${cut.pieces.length} סוגי חיתוך, בערך ${fmt(cut.totalKg)} ק״ג ברזל${sc.finish?.name ? `. גמר: ${sc.finish.name}` : ''}`;
  $('notes').innerHTML = (sc.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
  $('warnings').hidden = warnings.length === 0;
  $('warnings').textContent = warnings.length ? `בדיקת הפריסה: ${warnings.slice(0, 4).join('; ')}` : '';
  $('source').innerHTML = sc.source ? `מבוסס על פרויקט מהרשת: <a href="${esc(sc.source.url)}" target="_blank" rel="noreferrer">${esc(sc.source.title || sc.source.url)}</a>` : '';

  const rows = cut.pieces
    .map((p) => `<tr><td class="mark">${p.mark}</td><td>${esc(p.name)}${p.bent ? ' <span class="muted">(מכופף)</span>' : ''}</td><td class="num">${p.count}</td><td class="num">${fmt(p.length)}</td></tr>`)
    .join('');
  const buy = cut.sections.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${(s.totalMm / 1000).toFixed(2)} מ׳</td><td class="num">${fmt(s.kg)} ק״ג</td></tr>`).join('');
  const plates = cut.plates.map((p) => `<tr><td>${esc(p.name)} ${fmt(p.w)}/${fmt(p.h)}</td><td class="num">${p.count}</td><td class="num">${p.areaM2} מ״ר</td></tr>`).join('');
  const parts = cut.parts.map((p) => `${esc(p.label)} ${p.count}`).join(', ');
  $('panel-cut').innerHTML = `
    <table><thead><tr><th>סימון</th><th>תיאור</th><th class="num">כמות</th><th class="num">אורך (מ״מ)</th></tr></thead><tbody>${rows}</tbody></table>
    <h2 style="margin-top:22px">מה לקנות</h2>
    <table><thead><tr><th>פרופיל</th><th class="num">סה״כ</th><th class="num">משקל</th></tr></thead><tbody>${buy}</tbody></table>
    ${plates ? `<h2 style="margin-top:22px">פחים</h2><table><tbody>${plates}</tbody></table>` : ''}
    ${parts ? `<p><b>פרזול:</b> ${parts}</p>` : ''}
    <p class="small muted">אורכי חיתוך לפי מרכז הפרופיל, חיבורי קצה ישרים. משקל משוער: ${fmt(cut.totalKg)} ק״ג.</p>`;
  state.svg = C.shopDrawingSvg(sc, { cut, date: new Intl.DateTimeFormat('he-IL').format(new Date()) });
  $('drawing').innerHTML = state.svg;
  $('json').value = JSON.stringify(state.raw, null, 2);
}

function show(raw, { key, keepCamera = false } = {}) {
  const prepared = C.prepareScene(raw);
  if (prepared.errors.length) return prepared;
  state.raw = raw;
  state.prepared = prepared;
  state.cut = C.cutList(prepared.scene);
  state.key = key;
  viewer.show(prepared, state.cut, { keepCamera });
  $('open-row').hidden = !viewer.hasMovers;
  renderInfo();
  renderChips();
  updateChat();
  return prepared;
}

// --------------------------------------------------------------------------------- examples and hash
const KEYS = Object.keys(EXAMPLES);
function renderChips() {
  const mine = loadMine();
  const chips = [...KEYS.map((k) => [k, EXAMPLES[k].label]), ...(mine ? [['mine', 'שלי']] : [])];
  $('examples').innerHTML = chips
    .map(([k, label]) => `<button type="button" class="chip" data-key="${k}" aria-pressed="${state.key === k}">${esc(label)}</button>`)
    .join('');
}
$('examples').addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (b) location.hash = b.dataset.key;
});
function openFromHash() {
  const key = location.hash.slice(1);
  if (key === 'mine') {
    const mine = loadMine();
    if (mine) {
      state.requests = mine.requests || [];
      state.undo = mine.undo || [];
      state.mode = 'edit';
      show(mine.raw, { key: 'mine' });
      return;
    }
  }
  const k = EXAMPLES[key] ? key : KEYS[0];
  state.requests = [];
  state.undo = [];
  state.mode = 'edit';
  show(EXAMPLES[k].layout, { key: k });
}
addEventListener('hashchange', openFromHash);

// ----------------------------------------------------------------------------------------- AI chat
let sample = null;
let dictation = null;
let downloads = null;
let image = null;
let ctl = null;

function updateChat() {
  const editing = state.mode === 'edit' && state.raw;
  $('chat-title').textContent = editing ? 'מה לשנות?' : 'ספר על העבודה';
  $('ask').placeholder = editing
    ? 'למשל: להגביה ב־20 ס״מ, שבכה כל 10 ס״מ, להוסיף משקוף באמצע, להחליף לשער הזזה'
    : 'למשל: שער כנף כפולה לחניה, פתח 4 מטר, גובה 1.80. עמודים 100/100, מסגרת 60/40, שבכה 20/20 כל 12 ס״מ, צבע אפור. אפשר להדביק כתב כמויות.';
  $('send').textContent = editing ? 'עדכן את המודל' : 'צור הדמיה';
  $('undo').hidden = !(state.key === 'mine' && state.undo.length);
  $('history').innerHTML = state.key === 'mine' ? state.requests.slice(-8).map((r) => `<span>${esc(r)}</span>`).join('') : '';
}

function busy(on, text = 'חושב...') {
  $('busy').hidden = !on;
  $('busy-text').textContent = text;
  $('send').disabled = on;
}
function chatError(text) {
  $('chat-error').hidden = !text;
  $('chat-error').textContent = text || '';
}
const ERRORS = {
  not_granted: 'לא אושר שימוש ב־Claude בדף הזה.',
  rate_limited: 'יותר מדי בקשות כרגע. נסה שוב בעוד דקה.',
  invalid_json: 'התשובה לא הייתה פריסה תקינה. נסה שוב או נסח אחרת.',
  refused: 'הבקשה נדחתה. נסח אחרת.',
  session_expired: 'צריך להתחבר מחדש ל־Claude.',
  prompt_too_large: 'הבקשה ארוכה מדי.',
};

function buildPrompt(request) {
  const editing = state.mode === 'edit' && state.raw;
  return C.buildLayoutPrompt({
    current: editing ? state.raw : undefined,
    requests: editing ? state.requests : [],
    request,
    hasImage: Boolean(image),
  });
}

async function send() {
  const request = $('ask').value.trim();
  if (request.length < 3) return chatError('כתוב מה לבנות או מה לשנות.');
  if (!sample) return;
  chatError('');
  ctl = new AbortController();
  const started = performance.now();
  const tick = setInterval(() => {
    const s = Math.round((performance.now() - started) / 1000);
    if ($('busy-text').dataset.streaming !== '1') $('busy-text').textContent = `חושב על הפריסה... ${s} שנ׳`;
  }, 1000);
  $('busy-text').dataset.streaming = '0';
  busy(true);
  try {
    const opts = {
      modelTier: 'complex',
      cache: false,
      signal: ctl.signal,
      onText: ({ text }) => {
        $('busy-text').dataset.streaming = '1';
        $('busy-text').textContent = `כותב את המודל... ${fmt(text.length)} תווים`;
      },
    };
    if (image) opts.images = [image];
    const layout = await sample.json(buildPrompt(request), opts);
    const previous = state.raw;
    const wasEdit = state.mode === 'edit' && previous;
    const prepared = C.prepareScene(layout);
    if (prepared.errors.length) throw { code: 'layout', message: prepared.errors.join(', ') };
    if (state.key !== 'mine') {
      state.requests = [];
      state.undo = [];
    }
    if (wasEdit) state.undo.push(previous);
    state.requests = wasEdit ? [...state.requests, request] : [request];
    state.mode = 'edit';
    show(layout, { key: 'mine', keepCamera: Boolean(wasEdit) });
    saveMine();
    history.replaceState(null, '', '#mine');
    renderChips();
    updateChat();
    $('ask').value = '';
    clearImage();
    toast(wasEdit ? 'המודל עודכן' : 'ההדמיה מוכנה');
  } catch (e) {
    if (e?.code === 'cancelled') return;
    if (e?.code === 'layout') chatError(`הפריסה שהתקבלה לא תקינה (${e.message}). נסה לנסח אחרת.`);
    else chatError(ERRORS[e?.code] || 'משהו השתבש. אפשר לנסות שוב.');
    if (e?.code === 'not_granted' || e?.code === 'sampling_disabled') hideChat('השימוש ב־Claude לא אושר בתצוגה הזו. אפשר לעבוד עם Gemini לפי ההסבר למטה.');
  } finally {
    clearInterval(tick);
    busy(false);
    ctl = null;
  }
}
$('send').onclick = send;
$('stop').onclick = () => ctl?.abort();
$('new').onclick = () => {
  state.mode = 'new';
  updateChat();
  $('ask').focus();
};
$('undo').onclick = () => {
  const prev = state.undo.pop();
  if (!prev) return;
  state.requests.pop();
  show(prev, { key: 'mine', keepCamera: true });
  saveMine();
  updateChat();
  toast('השינוי האחרון בוטל');
};

function hideChat(text) {
  $('chat-body').hidden = true;
  $('chat-hint').textContent = text;
}

// Photo or sketch
function clearImage() {
  image = null;
  $('photo').value = '';
  $('image-name').hidden = true;
}
$('photo').addEventListener('change', (e) => {
  image = e.target.files?.[0] || null;
  $('image-name').hidden = !image;
  $('image-name').textContent = image ? `מצורף: ${image.name}` : '';
});

// Dictation
let listening = false;
$('mic').onclick = () => {
  if (!dictation) return;
  if (listening) {
    dictation.stop().catch(() => {});
    return;
  }
  dictation.start().catch((e) => {
    if (e?.code === 'not_granted') $('mic').hidden = true;
  });
};

// Capabilities light up when the viewer answers (null outside Claude)
const use = (name) => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
use('sample').then(async (s) => {
  sample = s;
  if (!s) {
    hideChat('הצ׳אט פועל כשהדף פתוח בתוך Claude. בינתיים אפשר לעבוד עם Gemini לפי ההסבר למטה.');
    return;
  }
  $('chat-body').hidden = false;
  $('chat-hint').textContent = 'כותבים או מכתיבים. Claude בונה את המודל, והשרטוט ורשימת החיתוך מתעדכנים איתו. כל עדכון לוקח בערך דקה.';
  const limits = await s.limits().catch(() => null);
  $('photo-label').hidden = !limits?.images;
});
use('dictation').then((d) => {
  dictation = d;
  if (!d) return;
  $('mic').hidden = false;
  let base = '';
  d.onState(({ state: st }) => {
    listening = st === 'listening';
    $('mic').setAttribute('aria-pressed', String(listening));
    $('mic-label').textContent = listening ? 'מקשיב...' : 'הכתבה';
    if (listening) base = $('ask').value ? `${$('ask').value.trim()} ` : '';
  });
  d.onPartial(({ text }) => ($('ask').value = base + text));
  d.onFinal(({ text }) => {
    base += `${text} `;
    $('ask').value = base;
  });
});
use('downloads').then((d) => {
  downloads = d;
  $('dl-svg').hidden = !d;
  $('dl-csv').hidden = !d;
  $('t-shot').hidden = !d;
});

async function save(filename, data) {
  if (!downloads) return;
  try {
    await downloads.save({ filename, data });
  } catch (e) {
    if (e?.code !== 'declined') toast('ההורדה לא זמינה כאן');
  }
}
const slug = () => (state.key === 'mine' ? 'my-design' : state.key);
$('dl-svg').onclick = () => save(`shop-drawing-${slug()}.svg`, state.svg);
$('dl-csv').onclick = () => {
  const rows = [['סימון', 'תיאור', 'כמות', 'אורך מ״מ'], ...state.cut.pieces.map((p) => [p.mark, p.name, p.count, p.length])];
  save(`cut-list-${slug()}.csv`, `﻿${rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')}`);
};
$('t-shot').onclick = () => viewer.screenshot().then((blob) => blob && save(`${slug()}.png`, blob));

// Tabs
for (const id of ['cut', 'draw', 'json']) {
  $(`tab-${id}`).onclick = () => {
    for (const other of ['cut', 'draw', 'json']) {
      $(`tab-${other}`).setAttribute('aria-selected', String(other === id));
      $(`panel-${other}`).hidden = other !== id;
    }
  };
}

// JSON paste
$('json-apply').onclick = () => {
  $('json-error').hidden = true;
  let raw;
  try {
    const t = $('json').value;
    raw = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  } catch {
    $('json-error').hidden = false;
    $('json-error').textContent = 'זה לא JSON תקין. העתק את כל התשובה, מהסוגריים הראשונים עד האחרונים.';
    return;
  }
  const previous = state.raw;
  const p = show(raw, { key: 'mine' });
  if (p.errors.length) {
    $('json-error').hidden = false;
    $('json-error').textContent = p.errors.join(', ');
    return;
  }
  if (previous && state.key === 'mine') state.undo.push(previous);
  state.mode = 'edit';
  saveMine();
  history.replaceState(null, '', '#mine');
  renderChips();
  toast('הפריסה הוצגה');
};
$('json-copy').onclick = () => navigator.clipboard.writeText($('json').value).then(() => toast('הועתק'), () => toast('לא הצלחתי להעתיק'));
$('instructions').textContent = INSTRUCTIONS;
$('copy-instructions').onclick = () =>
  navigator.clipboard.writeText(INSTRUCTIONS).then(() => toast('ההנחיות הועתקו'), () => toast('לא הצלחתי להעתיק. אפשר לסמן ולהעתיק מהטקסט'));

openFromHash();
