// @ts-check
import { startChat } from "./chat.js";
/** @typedef {{start:number, end:number, count:number}} Bin */
/** @typedef {{name:string, count:number, bins:Bin[]}} Group */
/** @typedef {{source:string, target:string, count:number}} Route */
/** @typedef {{memory:number, documents:number, indexed:number, links:number, groups:Group[], routes:Route[]}} Overview */
/** @typedef {{id:number, label:string, size?:number, indexed?:boolean}} Item */
/** @typedef {{id:number, group:string, label:string, excerpt?:string}} Match */
/** @typedef {{group:string, items:Item[], links:{source:number,target:number}[], external:{id:number,group:string,count:number}[], next:number|null}} Page */
/** @typedef {{name:string, start:number, end:number}} Focus */
/** @typedef {{x:number,y:number}} Point */

const svg = /** @type {SVGSVGElement} */ (document.querySelector('#universe'));
const categories = [
  { name: 'Знания', color: '#82b7db' },
  { name: 'Навыки', color: '#71d8cd' },
  { name: 'Опыт', color: '#dcac75' },
  { name: 'Личность', color: '#ad9ad2' },
  { name: 'Документы', color: '#8bc8ad' },
];
const get = (/** @type {string} */ id) => document.getElementById(id);
const mapStatus = get('map-status');
const format = new Intl.NumberFormat('ru-RU');
const fmt = (/** @type {number} */ value) => format.format(value);
const defaults = { start: 1, end: Number.MAX_SAFE_INTEGER };
const demoElement = get('demo-data');
const demo = /** @type {{overview:Overview, pages:Record<string,Page>}|null} */ (demoElement ? JSON.parse(demoElement.textContent) : null);

/** @type {Overview|null} */ let overview = null;
/** @type {Page|null} */ let page = null;
/** @type {Focus|null} */ let focus = null;
/** @type {number[]} */ let history = [];
let after = 0, chosen = 0, request = 0, pending = false;
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
  shape('circle', { r: 497, fill: 'url(#orbit-nebula)' }, grid);
  for (const r of [99, 132, 179, 213, 249, 291, 334, 374, 421, 452, 486, 500]) {
    shape('circle', { r, fill: 'none', stroke: '#6e9aa6', 'stroke-width': r === 500 ? 1.1 : .73, opacity: r >= 421 ? .23 : .12 }, grid);
  }
  for (let i = 0; i < 96; i++) {
    const a = i * 3.75;
    const p = point(a, i % 4 ? 496 : 490), q = point(a, 501);
    shape('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: '#6a98a6', opacity: i % 4 ? .15 : .33 }, grid);
  }
  for (let i = 0; i < 115; i++) {
    const p = point(i * 137.508, 110 + (i * 641 % 377));
    shape('circle', { cx: p.x, cy: p.y, r: i % 17 === 0 ? 1.55 : .65, fill: '#a6c8d5', opacity: i % 17 === 0 ? .38 : .19 }, grid);
  }
  const scanner = shape('g', { class: 'orbit-scanner' }, grid);
  shape('path', { d: arc(-128, -92, 500), stroke: '#79c9c8', 'stroke-width': 1.2, opacity: .38, fill: 'none' }, scanner);
  const scan = point(-92, 500);
  shape('circle', { cx: scan.x, cy: scan.y, r: 2, fill: '#a8e4dd', opacity: .72 }, scanner);
}

/** @param {SVGElement} parent */
function drawCore(parent) {
  for (let i = 0; i < 2; i++) {
    shape('circle', { r: 78, fill: 'none', stroke: '#64ebe8', 'stroke-width': 1.3, class: 'core-wave', style: 'animation-delay:' + i * -2.9 + 's' }, parent);
  }
  shape('circle', { r: 75, fill: 'none', stroke: '#69c5bf', 'stroke-width': 1, opacity: .52, class: 'core-aura' }, parent);
  const nucleus = shape('circle', { r: 63, fill: 'url(#core-light)', stroke: '#63e5df', 'stroke-width': 1.7, color: '#63e5df' }, parent);
  if (focus) activate(nucleus, 'Общий вид', () => {
    openOverview();
    svg.focus();
  });
  shape('circle', { r: 57, fill: 'none', stroke: '#63e5df', opacity: .32, 'pointer-events': 'none' }, parent);
  const rotor = shape('g', { class: 'core-rotor', 'aria-hidden': 'true' }, parent);
  for (const degrees of [-92, 28, 148]) {
    shape('path', { d: arc(degrees, degrees + 36, 76), stroke: '#6ff5eb', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none', opacity: .8 }, rotor);
    const p = point(degrees + 36, 76);
    shape('circle', { cx: p.x, cy: p.y, r: 2.2, fill: '#f2ffff' }, rotor);
  }
  const count = focus ? page?.items.length || 0 : (overview?.memory || 0) + (overview?.documents || 0);
  label(parent, { x: 0, y: -19 }, focus?.name || 'Ядро', '#b7e7ec', 16);
  label(parent, { x: 0, y: 13 }, fmt(count), '#f4feff', 32);
  label(parent, { x: 0, y: 35 }, focus ? 'Общий вид' : 'записей и файлов', '#adc4d9', 12);
}

/** @param {Group} group @param {number} i @param {SVGElement} nodes @param {number} maximum */
function drawGroup(group, i, nodes, maximum) {
  const { color, name } = categories[i];
  const a = angle(i);
  const width = group.bins[0] ? group.bins[0].end - group.bins[0].start + 1 : 1;
  const hub = point(a, 137);
  const caption = point(a, 333);
  label(nodes, caption, name + '  ' + fmt(group.count), color, 15);
  shape('path', { d: arc(a - 28, a + 28, 472), stroke: color, 'stroke-width': .9, opacity: .25, fill: 'none' }, nodes);

  for (const bin of group.bins) {
    const slot = (bin.start - 1) / width;
    const openBin = () => open(name, bin.start, bin.end);
    const range = name + ' · ' + fmt(bin.count);
    const outerAngle = a + ((slot % 8) - 3.5) * 5.9 + (slot >= 8 ? 1.8 : 0);
    const outerRadius = 456 - Math.floor(slot / 8) * 24;
    const outer = point(outerAngle, outerRadius);
    const ring = shape('circle', { cx: outer.x, cy: outer.y, r: 9.2, fill: '#0e1c24', stroke: color, 'stroke-width': 1.2, color, class: 'orbit-token' }, nodes);
    activate(ring, 'Орбита: ' + range, openBin);
    shape('circle', { cx: outer.x, cy: outer.y, r: 5.6, fill: 'none', stroke: color, 'stroke-width': .8, opacity: .64, 'pointer-events': 'none' }, nodes);
    shape('circle', { cx: outer.x, cy: outer.y, r: 1.65, fill: color, opacity: .92, 'pointer-events': 'none' }, nodes);
    if (slot < 8 && bin.count > maximum * .24) {
      const satellite = point(outerAngle - 1.9, 477);
      shape('circle', { cx: satellite.x, cy: satellite.y, r: 5.2, fill: '#0d1b23', stroke: color, 'stroke-width': .9, opacity: .64 }, nodes);
      shape('circle', { cx: satellite.x, cy: satellite.y, r: 1.25, fill: color, opacity: .71 }, nodes);
    }

    const degrees = a + ((slot % 4) - 1.5) * 11.5;
    const radius = 168 + Math.floor(slot / 4) * 35;
    const p = point(degrees, radius);
    const cluster = shape('g', { color, class: 'micro-cluster' }, nodes);
    activate(cluster, 'Кластер: ' + range, openBin);
    shape('circle', { cx: p.x, cy: p.y, r: 16, fill: 'transparent', stroke: 'transparent', class: 'cluster-target' }, cluster);
    const dots = Math.max(1, Math.ceil(Math.sqrt(bin.count / maximum) * 22));
    const rows = Math.ceil(dots / 5);
    for (let dot = 0; dot < dots; dot++) {
      const dotAngle = degrees + (dot % 5 - 2) * (280 / radius);
      const q = point(dotAngle, radius + (Math.floor(dot / 5) - (rows - 1) / 2) * 5.1);
      const signal = (slot * 7 + dot * 3 + i) % 13 === 0;
      shape('circle', { cx: q.x, cy: q.y, r: signal ? 2.05 : 1.55, fill: color, opacity: signal ? .95 : .64, class: signal ? 'cluster-signal' : '', 'pointer-events': 'none' }, cluster);
    }
    if (slot % 3 === 0) {
      const d = 'M ' + xy(p) + ' Q ' + xy(point(degrees, 313)) + ' ' + xy(outer);
      shape('path', { d, fill: 'none', stroke: color, 'stroke-width': .65, opacity: .17, 'pointer-events': 'none' }, nodes);
    }
  }
  const node = shape('circle', { cx: hub.x, cy: hub.y, r: 9, fill: '#0d1a22', stroke: color, 'stroke-width': 1.6, color }, nodes);
  activate(node, name + ' · ' + fmt(group.count), () => open(name));
  shape('circle', { cx: hub.x, cy: hub.y, r: 3.3, fill: color, 'pointer-events': 'none' }, nodes);
}

function drawOverview() {
  if (!overview) return;
  const routes = shape('g', {}, content), nodes = shape('g', {}, content);
  const maximum = Math.max(1, ...overview.groups.flatMap(group => group.bins.map(bin => bin.count)));
  overview.routes.forEach((route, i) => {
    const from = indexOf(route.source), to = indexOf(route.target);
    if (from < 0 || to < 0) return;
    const a = angle(from), b = angle(to);
    const hub = point(a, 137);
    const distance = Math.min(Math.abs(from - to), 5 - Math.abs(from - to));
    const radius = distance === 1 ? 246 + i % 5 * 24 : 98 + i % 5 * 10;
    const d = from === to
      ? 'M ' + xy(hub) + ' Q ' + xy(point(a - 18, 180)) + ' ' + xy(point(a, 187)) +
        ' Q ' + xy(point(a + 18, 180)) + ' ' + xy(hub)
      : track(a, b, 137, 137, radius);
    const lane = shape('g', {}, routes);
    shape('title', {}, lane).textContent = route.source + ' / ' + route.target + ' · ' + fmt(route.count);
    drawRoute(lane, d, categories[from].color, route.count, true);
  });
  for (const group of overview.groups) {
    const i = indexOf(group.name);
    if (i < 0) continue;
    drawGroup(group, i, nodes, maximum);
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
  page.items.forEach(item => {
    const p = positions.get(item.id);
    const highlighted = selected.has(item.id);
    const attrs = { fill: highlighted ? '#fff' : '#102338', stroke: color, 'stroke-width': highlighted ? 3 : 2, color };
    const node = groupIndex === 4
      ? shape('rect', { x: p.x - 5, y: p.y - 6, width: 10, height: 12, rx: 2, ...attrs }, nodes)
      : shape('circle', { cx: p.x, cy: p.y, r: highlighted ? 8 : 5.7, ...attrs }, nodes);
    node.dataset.entry = String(item.id);
    activate(node, item.label, () => choose(item, node === document.activeElement));
    if (chosen === item.id) {
      node.classList.add('universe-selected');
      shape('circle', { cx: p.x, cy: p.y, r: 16, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: .8, class: 'selection-ring', 'pointer-events': 'none' }, nodes);
    }
    if (page.items.length <= 16 || highlighted) {
      const name = item.label.length > 22 ? item.label.slice(0, 21) + '…' : item.label;
      label(nodes, { x: p.x, y: p.y - 14 }, name, color, 14);
    }
  });
}

function renderMap(animate = false) {
  svg.dataset.view = focus ? 'detail' : 'overview';
  content.replaceChildren();
  content.classList.remove('scene-content');
  if (focus) drawDetails();
  else drawOverview();
  drawCore(content);
  if (focus) drawPaging(content);
  if (animate) {
    content.getBoundingClientRect();
    content.classList.add('scene-content');
  }
}

/** @param {Item} item @param {boolean} [restoreFocus] */
function choose(item, restoreFocus = false) {
  chosen = item.id;
  mapStatus.textContent = item.label;
  renderMap();
  if (restoreFocus) {
    const node = /** @type {SVGElement|null} */ (svg.querySelector('[data-entry="' + item.id + '"]'));
    node?.focus();
  }
}

function getSelection() {
  const item = page?.items.find(value => value.id === chosen);
  if (!item) return null;
  const connections = [];
  const onPage = page.links.filter(link => link.source === chosen || link.target === chosen).length;
  if (onPage) connections.push('На странице · ' + fmt(onPage));
  for (const edge of page.external) {
    if (edge.id !== chosen) continue;
    const inGroup = edge.group === focus?.name;
    const count = edge.count - (inGroup ? onPage : 0);
    if (count > 0) connections.push(edge.group + (inGroup ? ' вне страницы' : '') + ' · ' + fmt(count));
  }
  return { label: item.label, connections };
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
    mapStatus.textContent = result.memory || result.documents
      ? 'Карта загружена.'
      : 'Карта пока пуста. Добавьте файлы в Aspksa/Документы.';
    renderMap(true);
  } catch {
    if (token === request) mapStatus.textContent = 'Не удалось загрузить карту';
  }
}

/** @param {Focus} target @param {number} cursor @param {number[]} stack @param {Match} [match] */
async function loadPage(target, cursor, stack, match) {
  const token = ++request;
  const fromMap = svg.contains(document.activeElement);
  let loaded = false;
  pending = true;
  mapStatus.textContent = 'Загрузка…';
  const q = new URLSearchParams({ group: target.name, after: String(cursor), start: String(target.start), end: String(target.end) });
  try {
    const result = demo
      ? match ? getDemoMatchPage(match) : demo.pages[q.toString()]
      : await fetchData('/api/universe/page?' + q);
    if (token !== request) return;
    if (!result) throw Error('Missing page');
    loaded = true;
    focus = target;
    page = result;
    after = cursor;
    history = stack;
    chosen = 0;
    mapStatus.textContent = page.items.length ? fmt(page.items.length) + ' элементов на странице' : 'В этой категории пока нет записей.';
  } catch {
    if (token === request) mapStatus.textContent = 'Не удалось загрузить записи.';
  } finally {
    if (token === request) {
      pending = false;
      renderMap(true);
      if (loaded && fromMap && document.activeElement === document.body) svg.focus();
    }
  }
  if (match && loaded && token === request) {
    const item = page.items.find(row => row.id === match.id);
    if (item) {
      choose(item);
      svg.scrollIntoView({ block: 'nearest' });
      return true;
    }
  }
  return false;
}

/** @param {string} name @param {number} [start] @param {number} [end] */
function open(name, start = defaults.start, end = defaults.end) {
  setView(1, 0, 0);
  void loadPage({ name, start, end }, 0, []);
}

function openOverview() {
  request++;
  pending = false;
  focus = null;
  page = null;
  history = [];
  chosen = 0;
  mapStatus.textContent = 'Общий вид карты.';
  setView(1, 0, 0);
  renderMap(true);
  if (!overview) void loadOverview();
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

/** @param {SVGElement} parent */
function drawPaging(parent) {
  const group = shape('g', { class: 'map-paging' }, parent);
  const controls = [
    { x: -81, title: 'Назад', available: history.length > 0, action: () => loadPage(focus, history[history.length - 1], history.slice(0, -1)) },
    { x: 11, title: 'Далее', available: !!page?.next, action: () => loadPage(focus, page.next, [...history, after]) },
  ];
  for (const { x, title, available, action } of controls) {
    if (!available) continue;
    const control = shape('rect', { x, y: 389, width: 70, height: 27, rx: 13, fill: '#112638', stroke: '#649ea8', color: '#63e5df' }, group);
    activate(control, title, () => { if (!pending) void action(); });
    label(group, { x: x + 35, y: 407 }, title, '#d6ecf4', 13);
  }
}

svg.addEventListener('keydown', event => {
  if (event.key === 'Escape' && focus) openOverview();
  else if (event.key === '0') setView(1, 0, 0);
  else if (event.key === '+' || event.key === '=') zoom(1.28, { x: 0, y: 0 });
  else if (event.key === '-') zoom(1 / 1.28, { x: 0, y: 0 });
  else return;
  event.preventDefault();
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
const demoFullPages = demo ? Object.entries(demo.pages).filter(([key]) => {
  const q = new URLSearchParams(key);
  return q.get('start') === String(defaults.start) && q.get('end') === String(defaults.end);
}).map(([, value]) => value) : [];

/** @param {Match} match @returns {Page|null} */
function getDemoMatchPage(match) {
  const source = demoFullPages.find(row => row.group === match.group && row.items.some(item => item.id === match.id));
  if (!source) return null;
  return {
    group: source.group,
    items: source.items.filter(item => item.id === match.id),
    links: [],
    external: source.external.filter(edge => edge.id === match.id),
    next: null,
  };
}

startChat({
  overview: () => overview,
  selection: getSelection,
  search: query => {
    if (!demo) return fetchData('/api/universe/chat-search?' + new URLSearchParams({ q: query }));
    const matches = demoFullPages.flatMap(row => row.items
      .filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
      .map(item => ({ id: item.id, group: row.group, label: item.label })));
    return Promise.resolve(matches.slice(0, 8));
  },
  inspect: match => {
    if (indexOf(match.group) < 0) return Promise.resolve(false);
    setView(1, 0, 0);
    return loadPage({ name: match.group, start: match.id, end: match.id }, 0, [], match);
  },
});

if (demo) get('chat-source').textContent = 'Демонстрационные данные';
drawGrid();
renderMap();
void loadOverview();

export {};
