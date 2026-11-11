// @ts-check
/**
 * «Кратко» — личный упрощённый курс администратора.
 *
 * Отдельный модуль рядом с app.js (подключается в index.html). Сам ничего не инициализирует:
 * берёт уже запущенное приложением Firebase-приложение и показывает блок «Кратко»
 * только когда вошёл администратор.
 *
 * Данные: Firestore `private/kratko_<itemId>` = { subject, itemId, title, order, md, updatedAt }.
 * Читать и писать `private/*` может только администратор (firestore.rules).
 *
 * Где видно:
 *  - страница материала `#/i/<id>` — карточка «Кратко» над файлами;
 *  - страница предмета `#/s/<id>` — кнопка «Кратко по предмету», открывает все темы подряд.
 */

const FIREBASE_VERSION = '12.19.0';
const ADMIN_EMAIL = 'rahatulyerbolat05@gmail.com';
const URLS = {
  app: `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`,
  auth: `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`,
  firestore: `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`,
  marked: 'https://cdn.jsdelivr.net/npm/marked@18.0.14/lib/marked.esm.js',
  dompurify: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.es.mjs',
};

/** @type {{ db: any, fs: any } | null} */
let fb = null;
let enabled = false;
/** @type {Map<string, any>} itemId → doc data (null = нет кратко) */
const itemCache = new Map();
/** @type {Map<string, any[]>} subjectId → docs sorted by order */
const subjectCache = new Map();
/** @type {Promise<{ marked: any, DOMPurify: any }> | null} */
let libs = null;
let pending = 0;
let renderSeq = 0;

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

function loadLibs() {
  if (!libs) {
    libs = Promise.all([import(URLS.marked), import(URLS.dompurify)]).then(([m, d]) => {
      const marked = m.marked || m.default;
      return { marked, DOMPurify: d.default || d };
    });
    libs.catch(() => { libs = null; });
  }
  return libs;
}

/** @param {string} md */
async function toHtml(md) {
  const { marked, DOMPurify } = await loadLibs();
  const html = marked.parse(md || '', { async: false, gfm: true, breaks: false });
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^(?:https:|#)/i,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'img'],
    FORBID_ATTR: ['style'],
  });
}

/**
 * Small element helper (no inline styles: CSP style-src 'self').
 * @param {string} tag @param {Record<string, string>} [attrs] @param {(Node|string|null)[]} [kids]
 */
function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const kid of kids) if (kid != null) node.append(kid);
  return node;
}

/** @param {string} itemId */
async function getItem(itemId) {
  if (itemCache.has(itemId)) return itemCache.get(itemId);
  if (!fb) return null;
  const { fs, db } = fb;
  const snap = await fs.getDoc(fs.doc(db, 'private', `kratko_${itemId}`));
  const data = snap.exists() ? snap.data() : null;
  itemCache.set(itemId, data);
  return data;
}

/** @param {string} subjectId */
async function getSubject(subjectId) {
  if (subjectCache.has(subjectId)) return subjectCache.get(subjectId) || [];
  if (!fb) return [];
  const { fs, db } = fb;
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'private'), fs.where('subject', '==', subjectId)));
  /** @type {any[]} */
  const docs = [];
  snap.forEach((/** @type {any} */ d) => docs.push(d.data()));
  docs.sort((a, b) => String(a.order || '').localeCompare(String(b.order || '')));
  subjectCache.set(subjectId, docs);
  for (const d of docs) itemCache.set(d.itemId, d);
  return docs;
}

function currentKey() {
  const hash = location.hash || '';
  const item = hash.match(/^#\/i\/([^/?#]+)/);
  if (item) return { kind: 'item', id: decodeURIComponent(item[1]) };
  const subj = hash.match(/^#\/s\/([^/?#]+)/);
  if (subj) return { kind: 'subj', id: decodeURIComponent(subj[1]) };
  return null;
}

async function render() {
  const seq = ++renderSeq;
  const key = currentKey();
  const want = enabled && key ? `${key.kind}:${key.id}` : '';
  for (const node of Array.from(document.querySelectorAll('[data-kratko]'))) {
    if (/** @type {HTMLElement} */ (node).dataset.kratko !== want) node.remove();
  }
  if (!want || !key || document.querySelector(`[data-kratko="${CSS.escape(want)}"]`)) return;
  try {
    if (key.kind === 'item') {
      const page = document.querySelector('.item-page');
      const header = page?.querySelector('.item-header');
      if (!page || !header) return;
      const data = await getItem(key.id);
      if (!data || seq !== renderSeq || document.querySelector(`[data-kratko="${CSS.escape(want)}"]`)) return;
      const body = el('div', { class: 'prose' });
      body.innerHTML = await toHtml(data.md); // sanitised by DOMPurify
      if (seq !== renderSeq || !header.isConnected) return;
      const section = el('section', { class: 'group-section kratko', 'data-kratko': want }, [
        el('h2', { class: 'group-title' }, ['Кратко · видишь только ты']),
        el('div', { class: 'card kratko-card' }, [body]),
      ]);
      const summary = page.querySelector('.card.summary');
      (summary || header).after(section);
    } else {
      const info = document.querySelector('.page .info-card');
      if (!info) return;
      const docs = await getSubject(key.id);
      if (!docs.length || seq !== renderSeq || document.querySelector(`[data-kratko="${CSS.escape(want)}"]`)) return;
      const btn = el('button', { type: 'button', class: 'btn btn-tinted kratko-open', 'data-kratko': want }, [`Кратко по предмету — ${docs.length} ${plural(docs.length)} подряд`]);
      btn.addEventListener('click', () => openSubject(docs));
      if (info.isConnected) info.after(btn);
    }
  } catch (e) {
    console.warn('[kratko]', e);
  }
}

/** @param {number} n */
function plural(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'тема';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'темы';
  return 'тем';
}

/** @param {any[]} docs */
async function openSubject(docs) {
  const title = document.querySelector('.page h1')?.textContent || 'Предмет';
  const bodyWrap = el('div', { class: 'sheet-body kratko-sheet-body' });
  const close = el('button', { type: 'button', class: 'btn btn-plain btn-small' }, ['Готово']);
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'sheet kratko-sheet', 'aria-label': `Кратко: ${title}` }, [
    el('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet-header' }, [el('h2', { class: 'sheet-title' }, [`Кратко: ${title}`]), close]),
    bodyWrap,
  ]));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  for (const d of docs) {
    const prose = el('div', { class: 'prose' });
    prose.innerHTML = await toHtml(d.md); // sanitised by DOMPurify
    const link = el('a', { href: `#/i/${encodeURIComponent(d.itemId)}` }, [d.title || d.itemId]);
    link.addEventListener('click', () => dialog.close());
    bodyWrap.append(el('article', { class: 'kratko-topic' }, [el('h3', { class: 'kratko-topic-title' }, [link]), prose]));
  }
}

function schedule() {
  if (pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    void render();
  }, 60);
}

async function init() {
  const [appMod, authMod, fsMod] = await Promise.all([import(URLS.app), import(URLS.auth), import(URLS.firestore)]);
  let app = null;
  for (let i = 0; i < 150 && !app; i++) {
    const apps = appMod.getApps();
    if (apps.length) app = apps[0];
    else await sleep(200);
  }
  if (!app) return;
  const auth = authMod.getAuth(app);
  authMod.onAuthStateChanged(auth, (/** @type {any} */ u) => {
    enabled = !!u && u.email === ADMIN_EMAIL && !!u.emailVerified;
    if (enabled && !fb) fb = { db: fsMod.getFirestore(app), fs: fsMod };
    itemCache.clear();
    subjectCache.clear();
    schedule();
  });
  window.addEventListener('hashchange', schedule);
  const root = document.getElementById('app');
  if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
}

void init().catch((e) => console.warn('[kratko] init', e));
