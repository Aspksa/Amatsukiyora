// @ts-check
/** @typedef {{start:number, end:number, count:number}} Bin */
/** @typedef {{name:string, count:number, bins:Bin[]}} Group */
/** @typedef {{source:string, target:string, count:number}} Route */
/** @typedef {{memory:number, documents:number, indexed:number, links:number, groups:Group[], routes:Route[]}} Overview */
/** @typedef {{id:number, label:string, size?:number, indexed?:boolean}} Item */
/** @typedef {{group:string, items:Item[], links:{source:number,target:number}[], external:{id:number,group:string,count:number}[], next:number|null}} Page */
/** @typedef {{name:string, start:number, end:number}} Focus */
/** @typedef {{x:number,y:number}} Point */

const svg = /** @type {SVGSVGElement} */ (document.querySelector('#universe'));
const categories = [
  { name: 'Знания', color: '#65baff' },
  { name: 'Навыки', color: '#62ebd3' },
  { name: 'Опыт', color: '#ffc276' },
  { name: 'Личность', color: '#ba9aff' },
  { name: 'Документы', color: '#8cdda2' },
];
const get = (/** @type {string} */ id) => document.getElementById(id);
const button = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ (get(id));
const back = button('back'), prev = button('prev'), next = button('next'), refresh = button('refresh');
const detail = get('detail'), title = get('detail-title'), entries = get('entries'), legend = get('legend');
const format = new Intl.NumberFormat('ru-RU');
const fmt = (/** @type {number} */ value) => format.format(value);
const defaults = { start: 1, end: Number.MAX_SAFE_INTEGER };
const demoElement = get('demo-data');
const demo = /** @type {{overview:Overview, pages:Record<string,Page>}|null} */ (demoElement ? JSON.parse(demoElement.textContent) : null);

/** @type {Overview|null} */ let overview = null;
/** @type {Page|null} */ let page = null;
/** @type {Focus|null} */ let focus = null;
/** @type {number[]} */ let history = [];
let after = 0, chosen = 0, request = 0, pending = false, mode = 'all';
let scale = 1, x = 0, y = 0;

/** @template {keyof SVGElementTagNameMap} K
 * @param {K} tag @param {Record<string,string|number>} attrs @param {SVGElement} parent
 * @returns {SVGElementTagNameMap[K]} */
function shape(tag, attrs, parent) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent.append(node);
  return node;
}

const scene = shape('g', {}, svg);
const grid = shape('g', { 'aria-hidden': 'true' }, scene);
const content = shape('g', {}, scene);

/** @param {number} degrees @param {number} radius */
function point(degrees, radius) {
  const a = degrees * Math.PI / 180;
  return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
}

const angle = (/** @type {number} */ i) => -90 + i * 72;
const indexOf = (/** @type {string} */ name) => categories.findIndex(category => category.name === name);

/** @param {Point} p */
const xy = p => p.x.toFixed(2) + ' ' + p.y.toFixed(2);

/** @param {SVGElement} parent @param {Point} p @param {string} value @param {string} color @param {number} size */
function label(parent, p, value, color, size) {
  shape('text', { ...p, fill: color, 'font-size': size, 'text-anchor': 'middle', class: 'universe-text' }, parent).textContent = value;
}

/** @param {SVGElement} node @param {string} title @param {()=>void} action */
function activate(node, title, action) {
  node.classList.add('universe-node');
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', title);
  shape('title', {}, node).textContent = title;
  node.addEventListener('click', action);
  node.addEventListener('keydown', event => {
    const key = /** @type {KeyboardEvent} */ (event).key;
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      action();
    }
  });
}

/** @param {number} a @param {number} b @param {number} radius */
function arc(a, b, radius) {
  const delta = b - a;
  return 'M ' + xy(point(a, radius)) + ' A ' + radius + ' ' + radius + ' 0 ' +
    Number(Math.abs(delta) > 180) + ' ' + Number(delta > 0) + ' ' + xy(point(b, radius));
}

/** @param {number} a @param {number} b @param {number} start @param {number} end @param {number} radius */
function track(a, b, start, end, radius) {
  const signed = ((b - a + 540) % 360) - 180;
  const corner = Math.min(Math.abs(signed) / 3, 5) * Math.sign(signed);
  const from = a + corner, to = a + signed - corner;
  return 'M ' + xy(point(a, start)) + ' L ' + xy(point(a, radius - 13)) +
    ' Q ' + xy(point(a, radius)) + ' ' + xy(point(from, radius)) +
    (signed ? ' A ' + radius + ' ' + radius + ' 0 0 ' + Number(signed > 0) + ' ' + xy(point(to, radius)) : '') +
    ' Q ' + xy(point(b, radius)) + ' ' + xy(point(b, radius - 13)) +
    ' L ' + xy(point(b, end));
}

/** @param {SVGElement} parent @param {string} d @param {string} color @param {number} count @param {boolean} [animated] */
function drawRoute(parent, d, color, count, animated = false) {
  const width = Math.min(4.5, 1 + Math.log2(count + 1) * .48);
  if (animated) shape('path', { d, stroke: color, 'stroke-width': width + 7, class: 'universe-route route-glow' }, parent);
  shape('path', { d, stroke: color, 'stroke-width': width, opacity: .78, class: 'universe-route' }, parent);
  if (animated) shape('path', { d, stroke: '#eefbff', 'stroke-width': width * .72, class: 'universe-route route-current' }, parent);
}

function drawGrid() {
  for (const r of [86, 113, 154, 198, 245, 292, 341, 394, 445, 495]) {
    shape('circle', { r, fill: 'none', stroke: '#506281', 'stroke-width': r === 394 ? 1.3 : .8, opacity: r === 394 ? .6 : .31 }, grid);
  }
  for (let i = 0; i < 120; i++) {
    const a = i * 3;
    const p = point(a, i % 6 ? 488 : 478), q = point(a, 495);
    shape('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: '#879cbd', opacity: i % 6 ? .24 : .54 }, grid);
    if (i % 6 === 0) {
      const inner = point(a, 98), outer = point(a, 473);
      shape('line', { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, stroke: '#4b6686', opacity: .18 }, grid);
    }
  }
  for (let i = 0; i < 170; i++) {
    const p = point(i * 137.508, 106 + (i * 641 % 376));
    shape('circle', { cx: p.x, cy: p.y, r: i % 13 === 0 ? 1.45 : .75, fill: '#a4c6ed', opacity: i % 13 === 0 ? .53 : .27 }, grid);
  }
}

/** @param {SVGElement} parent */
function drawCore(parent) {
  shape('circle', { r: 75, fill: 'none', stroke: '#63e5df', 'stroke-width': 1, opacity: .6, class: 'core-aura' }, parent);
  shape('circle', { r: 63, fill: 'url(#core-light)', stroke: '#63e5df', 'stroke-width': 1.7, color: '#63e5df' }, parent);
  shape('circle', { r: 57, fill: 'none', stroke: '#63e5df', opacity: .32 }, parent);
  const count = focus ? page?.items.length || 0 : (overview?.memory || 0) + (overview?.documents || 0);
  label(parent, { x: 0, y: -19 }, focus?.name || 'Ядро', '#b7e7ec', 16);
  label(parent, { x: 0, y: 13 }, fmt(count), '#f4feff', 32);
  label(parent, { x: 0, y: 35 }, focus ? 'на странице' : 'записей и файлов', '#adc4d9', 12);
}

/** @param {Group} group @param {number} i @param {SVGElement} bars @param {SVGElement} nodes @param {number} maximum */
function drawGroup(group, i, bars, nodes, maximum) {
  const { color, name } = categories[i];
  const a = angle(i);
  const showBars = mode === 'all' || mode === 'stats';
  const showClusters = mode !== 'stats' && mode !== 'links';
  shape('path', { d: arc(a - 31, a + 31, 395), stroke: color, 'stroke-width': 2.4, opacity: .65, fill: 'none' }, bars);
  if (showBars) {
    const width = group.bins[0] ? group.bins[0].end - group.bins[0].start + 1 : 1;
    const bySlot = new Map(group.bins.map(bin => [(bin.start - 1) / width, bin]));
    for (let slot = 0; slot < 16; slot++) {
      const bin = bySlot.get(slot);
      const degrees = a + (slot - 7.5) * 3.65;
      const start = point(degrees, 403);
      const length = bin ? 9 + 62 * Math.sqrt(bin.count / maximum) : 4;
      const end = point(degrees, 403 + length);
      const bar = shape('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: color, 'stroke-width': bin ? 6 : 2, opacity: bin ? .9 : .23, color }, bars);
      if (bin) activate(bar, name + ' · ' + fmt(bin.count), () => open(name, bin.start, bin.end));
    }
  }
  if (showClusters) {
    group.bins.forEach(bin => {
      const slot = (bin.start - 1) / (bin.end - bin.start + 1);
      const degrees = a + ((slot % 4) - 1.5) * 11;
      const p = point(degrees, 222 + Math.floor(slot / 4) * 37);
      const origin = point(a, 154);
      shape('path', { d: 'M ' + xy(origin) + ' L ' + xy(point(degrees, 198)) + ' L ' + xy(p), fill: 'none', stroke: color, opacity: .24 }, nodes);
      const dot = shape('circle', { cx: p.x, cy: p.y, r: 4 + Math.min(5, Math.log2(bin.count + 1)), fill: '#102338', stroke: color, 'stroke-width': 2, color }, nodes);
      activate(dot, name + ' · ' + fmt(bin.count), () => open(name, bin.start, bin.end));
    });
  }
  const hub = point(a, 154);
  const node = shape('circle', { cx: hub.x, cy: hub.y, r: 11, fill: '#0b1627', stroke: color, 'stroke-width': 3, color }, nodes);
  activate(node, name + ' · ' + fmt(group.count), () => open(name));
  shape('circle', { cx: hub.x, cy: hub.y, r: 3, fill: color, 'pointer-events': 'none' }, nodes);
  const radial = point(a, 502);
  label(nodes, radial, name + '  ' + fmt(group.count), color, 16);
}

function drawOverview() {
  if (!overview) return;
  const bars = shape('g', {}, content), routes = shape('g', {}, content), nodes = shape('g', {}, content);
  const maximum = Math.max(1, ...overview.groups.flatMap(group => group.bins.map(bin => bin.count)));
  if (mode === 'all' || mode === 'links') {
    overview.routes.forEach((route, i) => {
      const from = indexOf(route.source), to = indexOf(route.target);
      if (from < 0 || to < 0) return;
      const a = angle(from), b = angle(to);
      const hub = point(a, 154);
      const distance = Math.min(Math.abs(from - to), 5 - Math.abs(from - to));
      const radius = distance === 1 ? 246 + i % 5 * 24 : 98 + i % 5 * 10;
      const d = from === to
        ? 'M ' + xy(hub) + ' Q ' + xy(point(a - 16, 207)) + ' ' + xy(point(a, 209)) +
          ' Q ' + xy(point(a + 16, 207)) + ' ' + xy(hub)
        : track(a, b, 154, 154, radius);
      drawRoute(routes, d, categories[from].color, route.count, true);
    });
  }
  for (const group of overview.groups) {
    const i = indexOf(group.name);
    if (i < 0 || mode === 'documents' && i !== 4 || mode === 'memory' && i === 4) continue;
    drawGroup(group, i, bars, nodes, maximum);
  }
}

function drawDetails() {
  if (!focus || !page) return;
  const groupIndex = indexOf(focus.name);
  const { color } = categories[groupIndex];
  const routes = shape('g', {}, content), nodes = shape('g', {}, content);
  const positions = new Map(page.items.map((item, i) => {
    const a = -86 + (i % 20) * 18 + Math.floor(i / 20) * 6;
    const r = 145 + Math.floor(i / 20) * 70;
    return [item.id, { a, r, ...point(a, r) }];
  }));
  const selected = new Set([chosen]);
  if (mode !== 'memory' && mode !== 'stats') {
    page.links.forEach((link, i) => {
      const from = positions.get(link.source), to = positions.get(link.target);
      const active = link.source === chosen || link.target === chosen;
      if (active) selected.add(link.source).add(link.target);
      drawRoute(routes, track(from.a, to.a, from.r, to.r, Math.max(from.r, to.r) + 16 + i % 4 * 5), color, active ? 12 : 1, active);
    });
    page.external.forEach(edge => {
      const i = indexOf(edge.group);
      if (i < 0 || i === groupIndex) return;
      const p = positions.get(edge.id);
      drawRoute(routes, track(p.a, angle(i) + 4, p.r, 435, 374 + i * 9), categories[i].color, edge.count, edge.id === chosen);
    });
    categories.forEach((category, i) => {
      if (i === groupIndex) return;
      const p = point(angle(i) + 4, 435);
      const station = shape('circle', { cx: p.x, cy: p.y, r: 8, stroke: category.color, fill: '#0b1627', 'stroke-width': 2, color: category.color }, nodes);
      activate(station, category.name, () => open(category.name));
      label(nodes, { x: p.x, y: p.y + 25 }, category.name, category.color, 15);
    });
  }
  page.items.forEach(item => {
    const p = positions.get(item.id);
    const highlighted = selected.has(item.id);
    const attrs = { fill: highlighted ? '#fff' : '#102338', stroke: color, 'stroke-width': highlighted ? 3 : 2, color };
    const node = groupIndex === 4
      ? shape('rect', { x: p.x - 5, y: p.y - 6, width: 10, height: 12, rx: 2, ...attrs }, nodes)
      : shape('circle', { cx: p.x, cy: p.y, r: highlighted ? 8 : 5.7, ...attrs }, nodes);
    node.dataset.entry = String(item.id);
    activate(node, item.label, () => choose(item, node === document.activeElement));
    if (chosen === item.id) node.classList.add('universe-selected');
    if (page.items.length <= 16 || highlighted) {
      const name = item.label.length > 22 ? item.label.slice(0, 21) + '…' : item.label;
      label(nodes, { x: p.x, y: p.y - 14 }, name, color, 14);
    }
  });
}

function renderMap(animate = false) {
  content.replaceChildren();
  content.classList.remove('scene-content');
  if (focus) drawDetails();
  else drawOverview();
  drawCore(content);
  if (animate) {
    content.getBoundingClientRect();
    content.classList.add('scene-content');
  }
}

/** @param {Item} item @param {boolean} [restoreFocus] */
function choose(item, restoreFocus = false) {
  chosen = item.id;
  detail.textContent = item.label + (focus?.name === 'Документы'
    ? ' · ' + fmt(item.size || 0) + ' байт · ' + (item.indexed ? 'текст проиндексирован' : 'метаданные')
    : '');
  for (const row of entries.querySelectorAll('button')) {
    row.setAttribute('aria-pressed', String(row.dataset.entry === String(item.id)));
  }
  renderMap();
  if (restoreFocus) {
    const node = /** @type {SVGElement|null} */ (svg.querySelector('[data-entry="' + item.id + '"]'));
    node?.focus();
  }
}

/** @param {boolean} [animate] */
function render(animate = false) {
  renderMap(animate);
  title.textContent = focus?.name || 'Обзор';
  get('map-title').textContent = focus?.name || 'Карта знаний';
  legend.querySelectorAll('button').forEach(row => {
    const group = overview?.groups.find(group => group.name === row.dataset.group);
    row.setAttribute('aria-pressed', String(row.dataset.group === focus?.name));
    row.querySelector('strong').textContent = group ? fmt(group.count) : '—';
  });
  for (const [id, value] of [
    ['memory-count', overview?.memory], ['document-count', overview?.documents], ['link-count', overview?.links],
  ]) {
    if (typeof id === 'string') get(id).textContent = typeof value === 'number' ? fmt(value) : '—';
  }
  back.hidden = !focus;
  prev.hidden = !focus || !history.length;
  next.hidden = !focus || !page?.next;
  prev.disabled = next.disabled = pending;
  entries.replaceChildren();
  for (const item of page?.items || []) {
    const row = document.createElement('button');
    row.textContent = item.label;
    row.dataset.entry = String(item.id);
    row.setAttribute('aria-pressed', 'false');
    row.addEventListener('click', () => choose(item));
    entries.append(row);
  }
}

/** @param {string} url @param {RequestInit} [options] */
async function fetchData(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response.json();
}

async function loadOverview() {
  const token = ++request;
  try {
    const result = demo?.overview || await fetchData('/api/universe');
    if (token !== request) return;
    overview = result;
    get('status').textContent = demo ? 'Демонстрационные данные' : 'Локальные данные';
    if (!focus) detail.textContent = result.memory || result.documents
      ? 'Выберите категорию или кластер на карте.'
      : 'Карта пока пуста. Добавьте файлы в Aspksa/Документы и обновите документы.';
    render(true);
  } catch {
    if (token === request) get('status').textContent = 'Не удалось загрузить карту';
  }
}

/** @param {Focus} target @param {number} cursor @param {number[]} stack */
async function loadPage(target, cursor, stack) {
  const token = ++request;
  const fromMap = svg.contains(document.activeElement);
  let loaded = false;
  pending = true;
  prev.disabled = next.disabled = true;
  detail.textContent = 'Загрузка…';
  const q = new URLSearchParams({ group: target.name, after: String(cursor), start: String(target.start), end: String(target.end) });
  try {
    const result = demo ? demo.pages[q.toString()] : await fetchData('/api/universe/page?' + q);
    if (token !== request) return;
    if (!result) throw Error('Missing page');
    loaded = true;
    focus = target;
    page = result;
    after = cursor;
    history = stack;
    chosen = 0;
    detail.textContent = page.items.length ? fmt(page.items.length) + ' элементов на странице' : 'В этой категории пока нет записей.';
  } catch {
    if (token === request) detail.textContent = 'Не удалось загрузить записи.';
  } finally {
    if (token === request) {
      pending = false;
      render(true);
      if (loaded && fromMap && document.activeElement === document.body) get('map-title').focus();
    }
  }
}

/** @param {string} name @param {number} [start] @param {number} [end] */
function open(name, start = defaults.start, end = defaults.end) {
  setView(1, 0, 0);
  void loadPage({ name, start, end }, 0, []);
}

/** @param {boolean} [retry] */
function openOverview(retry = true) {
  request++;
  pending = false;
  focus = null;
  page = null;
  history = [];
  chosen = 0;
  detail.textContent = 'Выберите категорию или кластер на карте.';
  setView(1, 0, 0);
  render(true);
  if (retry && !overview) void loadOverview();
}

/** @param {number} value @param {number} tx @param {number} ty */
function setView(value, tx, ty) {
  scale = value;
  x = tx;
  y = ty;
  scene.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + scale + ')');
}

/** @param {number} factor @param {Point} p */
function zoom(factor, p) {
  const value = Math.min(8, Math.max(.65, scale * factor));
  setView(value, p.x - (p.x - x) * value / scale, p.y - (p.y - y) * value / scale);
}

back.addEventListener('click', () => openOverview());
next.addEventListener('click', () => {
  if (focus && page?.next && !pending) void loadPage(focus, page.next, [...history, after]);
});
prev.addEventListener('click', () => {
  if (focus && history.length && !pending) void loadPage(focus, history[history.length - 1], history.slice(0, -1));
});
document.querySelectorAll('[data-mode]').forEach(control => control.addEventListener('click', () => {
  mode = control.getAttribute('data-mode');
  document.querySelectorAll('[data-mode]').forEach(row => row.setAttribute('aria-pressed', String(row === control)));
  openOverview();
}));
refresh.hidden = !!demo;
refresh.addEventListener('click', async () => {
  refresh.disabled = true;
  try {
    const scan = await fetchData('/api/universe/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    openOverview(false);
    await loadOverview();
    if (scan.errors) detail.textContent = 'Часть файлов недоступна: ' + scan.errors;
  } catch {
    detail.textContent = 'Не удалось обновить документы.';
  } finally {
    refresh.disabled = false;
  }
});

svg.addEventListener('wheel', event => {
  event.preventDefault();
  const matrix = svg.getScreenCTM();
  if (!matrix) return;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  zoom(Math.exp(-event.deltaY * .001), p);
}, { passive: false });
/** @type {{id:number,x:number,y:number}|null} */ let drag = null;
svg.addEventListener('pointerdown', event => {
  if (drag || /** @type {Element} */ (event.target).closest('.universe-node')) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const matrix = svg.getScreenCTM();
  if (!matrix) return;
  setView(scale, x + (event.clientX - drag.x) / matrix.a, y + (event.clientY - drag.y) / matrix.d);
  drag.x = event.clientX;
  drag.y = event.clientY;
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  svg.addEventListener(event, e => {
    if (drag?.id === /** @type {PointerEvent} */ (e).pointerId) drag = null;
  });
}
button('reset').addEventListener('click', () => setView(1, 0, 0));
button('zoom-in').addEventListener('click', () => zoom(1.28, { x: 0, y: 0 }));
button('zoom-out').addEventListener('click', () => zoom(1 / 1.28, { x: 0, y: 0 }));

for (const { name, color } of categories) {
  const row = document.createElement('button');
  const dot = document.createElement('i'), labelNode = document.createElement('span'), count = document.createElement('strong');
  labelNode.textContent = name;
  dot.setAttribute('aria-hidden', 'true');
  row.style.setProperty('--accent', color);
  row.dataset.group = name;
  row.append(dot, labelNode, count);
  row.addEventListener('click', () => open(name));
  legend.append(row);
}
drawGrid();
render();
void loadOverview();

export {};
