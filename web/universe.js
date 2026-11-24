// @ts-check
import { startChat } from "./chat.js";
import { request as apiRequest, startCloudSettings } from "./cloud-settings.js";
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
const selectionLabel = get('chat-selection');
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
const categoryColor = (/** @type {string} */ name) => categories[indexOf(name)]?.color || 'var(--muted)';
const isDocument = (/** @type {string} */ name) => name === 'Документы';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** @type {Match[]} */ let neighbors = [];

/** @param {number} index */
function entryPosition(index) {
  const row = Math.floor(index / 20);
  const a = -86 + (index % 20) * 18 + row * 6;
  const r = 145 + row * 70;
  return { a, r, ...point(a, r) };
}

/** @param {Point} p @param {string} group @param {SVGElement} parent @param {number} size @param {Record<string,string|number>} attrs */
function entryShape(p, group, parent, size, attrs) {
  return isDocument(group)
    ? shape('rect', { x: p.x - size, y: p.y - size * 1.15, width: size * 2, height: size * 2.3, rx: size * .28, ...attrs }, parent)
    : shape('circle', { cx: p.x, cy: p.y, r: size, ...attrs }, parent);
}

/** @param {Point} p */
const xy = p => p.x.toFixed(2) + ' ' + p.y.toFixed(2);

/** @param {SVGElement} parent @param {Point} p @param {string} value @param {string} color @param {number} size */
function label(parent, p, value, color, size) {
  const text = shape('text', { ...p, fill: color, 'font-size': size, 'text-anchor': 'middle', class: 'universe-text' }, parent);
  text.textContent = value;
  return text;
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
  activate(nucleus, 'Общий вид', () => {
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
  const clusters = shape('g', { class: 'overview-clusters' }, nodes);
  shape('path', { d: arc(a - 28, a + 28, 472), stroke: color, 'stroke-width': .9, opacity: .25, fill: 'none' }, nodes);

  for (const bin of group.bins) {
    const hit = matches.some(match => match.group === name && bin.start <= match.id && match.id <= bin.end);
    const slot = (bin.start - 1) / width;
    const range = name + ' · ' + fmt(bin.count);
    const outerAngle = a + ((slot % 8) - 3.5) * 5.9 + (slot >= 8 ? 1.8 : 0);
    const outerRadius = 456 - Math.floor(slot / 8) * 24;
    const outer = point(outerAngle, outerRadius);
    const ring = shape('circle', { cx: outer.x, cy: outer.y, r: 9.2, fill: '#0e1c24', stroke: color, 'stroke-width': 1.2, color, class: hit ? 'orbit-token chat-map-hit' : 'orbit-token' }, clusters);
    activate(ring, 'Орбита: ' + range, () => open(name, bin.start, bin.end, outer));
    shape('circle', { cx: outer.x, cy: outer.y, r: 5.6, fill: 'none', stroke: color, 'stroke-width': .8, opacity: .64, 'pointer-events': 'none' }, clusters);
    shape('circle', { cx: outer.x, cy: outer.y, r: 1.65, fill: color, opacity: .92, 'pointer-events': 'none' }, clusters);
    if (slot < 8 && bin.count > maximum * .24) {
      const satellite = point(outerAngle - 1.9, 477);
      shape('circle', { cx: satellite.x, cy: satellite.y, r: 5.2, fill: '#0d1b23', stroke: color, 'stroke-width': .9, opacity: .64 }, clusters);
      shape('circle', { cx: satellite.x, cy: satellite.y, r: 1.25, fill: color, opacity: .71 }, clusters);
    }

    const degrees = a + ((slot % 4) - 1.5) * 11.5;
    const radius = 168 + Math.floor(slot / 4) * 35;
    const p = point(degrees, radius);
    const cluster = shape('g', { color, class: 'micro-cluster' }, clusters);
    activate(cluster, 'Кластер: ' + range, () => open(name, bin.start, bin.end, p));
    cluster.dataset.cluster = clusterKey(name, bin);
    cluster.dataset.x = String(p.x);
    cluster.dataset.y = String(p.y);
    cluster.dataset.group = name;
    cluster.dataset.start = String(bin.start);
    cluster.dataset.end = String(bin.end);
    shape('circle', { cx: p.x, cy: p.y, r: 16, fill: 'transparent', stroke: 'transparent', class: hit ? 'cluster-target chat-map-hit' : 'cluster-target' }, cluster);
    const dots = Math.max(1, Math.ceil(Math.sqrt(bin.count / maximum) * 22));
    const rows = Math.ceil(dots / 5);
    for (let dot = 0; dot < dots; dot++) {
      const dotAngle = degrees + (dot % 5 - 2) * (280 / radius);
      const q = point(dotAngle, radius + (Math.floor(dot / 5) - (rows - 1) / 2) * 5.1);
      const signal = (slot * 7 + dot * 3 + i) % 13 === 0;
      shape('circle', { cx: q.x, cy: q.y, r: signal ? 2.05 : 1.55, fill: color, opacity: signal ? .95 : .64, class: signal ? 'cluster-signal' : '', 'pointer-events': 'none' }, cluster);
    }
    label(cluster, { x: p.x, y: p.y + 24 }, fmt(bin.count), color, 9).classList.add('cluster-count');
    if (slot % 3 === 0) {
      const d = 'M ' + xy(p) + ' Q ' + xy(point(degrees, 313)) + ' ' + xy(outer);
      shape('path', { d, fill: 'none', stroke: color, 'stroke-width': .65, opacity: .17, 'pointer-events': 'none' }, clusters);
    }
  }
  const category = shape('g', { color, class: 'category-target' }, nodes);
  activate(category, name + ' · ' + fmt(group.count), () => open(name));
  shape('circle', { cx: hub.x, cy: hub.y, r: 19, fill: 'transparent', stroke: 'none' }, category);
  shape('circle', { cx: hub.x, cy: hub.y, r: 9, fill: '#0d1a22', stroke: color, 'stroke-width': 1.6,
    class: matches.some(match => match.group === name) ? 'chat-map-hit' : '' }, category);
  shape('circle', { cx: hub.x, cy: hub.y, r: 3.3, fill: color, 'pointer-events': 'none' }, category);
  const captionText = label(category, caption, name + '  ' + fmt(group.count), color, 15);
  captionText.classList.add('category-caption');
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

/** @param {SVGElement} parent @param {Point} p @param {Match} item @param {number} priority @param {boolean} [offset] */
function entryLabel(parent, p, item, priority, offset = false) {
  const name = item.label.length > 29 ? item.label.slice(0, 28) + '…' : item.label;
  const text = label(parent, { x: p.x + (offset ? 11 : 0), y: p.y - (offset ? 1 : 14) },
    name, categoryColor(item.group), 13);
  if (offset) text.setAttribute('text-anchor', 'start');
  text.classList.add('entry-label');
  text.dataset.priority = String(priority);
  text.dataset.anchorX = String(p.x);
  text.dataset.anchorY = String(p.y);
}

/** @param {SVGElement} parent @param {Point} p @param {Point|null} origin @param {number} index */
function entryLayer(parent, p, origin, index) {
  const layer = shape('g', {}, parent);
  if (origin && !reducedMotion.matches) {
    layer.classList.add('cluster-entry-arrival');
    layer.animate([
      { transform: `translate(${origin.x - p.x}px, ${origin.y - p.y}px)`, opacity: .25 },
      { transform: 'translate(0px, 0px)', opacity: 1 },
    ], { duration: 480, delay: Math.min(index * 13, 220), easing: 'cubic-bezier(.19,.72,.29,1)', fill: 'backwards' });
  }
  return layer;
}

/** @param {Point|null} origin */
function drawDetails(origin) {
  if (!focus || !page) return;
  const group = focus.name;
  const groupIndex = indexOf(group);
  const color = categoryColor(group);
  const routes = shape('g', {}, content), nodes = shape('g', {}, content);
  const positions = new Map(page.items.map((item, i) => [item.id, entryPosition(i)]));
  const selected = new Set([chosen]);
  const selectedPoint = positions.get(chosen);
  page.links.forEach((link, i) => {
    const from = positions.get(link.source), to = positions.get(link.target);
    const active = link.source === chosen || link.target === chosen;
    if (active) selected.add(link.source).add(link.target);
    const lane = shape('g', { class: active ? 'direct-link' : 'detail-connection' }, routes);
    drawRoute(lane, track(from.a, to.a, from.r, to.r, Math.max(from.r, to.r) + 16 + i % 4 * 5), color, active ? 12 : 1, active);
  });
  page.external.forEach(edge => {
    const i = indexOf(edge.group);
    if (i < 0 || i === groupIndex || edge.id === chosen && neighbors.some(node => node.group === edge.group)) return;
    const p = positions.get(edge.id);
    const active = edge.id === chosen;
    const lane = shape('g', { class: active ? 'direct-link' : 'detail-connection' }, routes);
    drawRoute(lane, track(p.a, angle(i) + 4, p.r, 435, 374 + i * 9), categories[i].color, edge.count, active);
  });
  categories.forEach((category, i) => {
    if (i === groupIndex) return;
    const p = point(angle(i) + 4, 455);
    const station = shape('circle', { cx: p.x, cy: p.y, r: 8, stroke: category.color, fill: '#0b1627', 'stroke-width': 2, color: category.color,
      class: matches.some(match => match.group === category.name) ? 'chat-map-hit' : '' }, nodes);
    activate(station, category.name, () => open(category.name));
    label(nodes, { x: p.x, y: p.y + 25 }, category.name, category.color, 15);
  });
  if (selectedPoint) {
    const remote = neighbors.filter(node => node.group !== group || !positions.has(node.id));
    remote.forEach((neighbor, index) => {
      const p = point(-90 + index * 360 / remote.length, 395);
      const accent = categoryColor(neighbor.group);
      const lane = shape('g', { class: 'direct-link' }, routes);
      drawRoute(lane, `M ${xy(selectedPoint)} Q ${xy({ x: p.x * .65, y: p.y * .65 })} ${xy(p)}`, accent, 8, true);
      const node = entryShape(p, neighbor.group, nodes, 8, { fill: '#132532', stroke: accent, 'stroke-width': 2.5,
        color: accent, class: 'connected-node', 'data-neighbor': neighbor.group + ':' + neighbor.id });
      activate(node, neighbor.label, () => { void inspectMatch(neighbor); });
      entryLabel(nodes, p, neighbor, 2);
    });
  }
  page.items.forEach((item, index) => {
    const p = positions.get(item.id);
    const hit = matches.some(match => match.group === group && match.id === item.id);
    const isChosen = item.id === chosen;
    const highlighted = selected.has(item.id) || hit;
    const layer = entryLayer(nodes, p, origin, index);
    layer.classList.add('detail-node');
    if (highlighted) layer.classList.add('detail-node-related');
    const node = entryShape(p, group, layer, highlighted ? 8 : 6, {
      fill: highlighted ? color : '#102338', stroke: color, 'stroke-width': highlighted ? 2.6 : 2, color,
      'data-entry': item.id, 'data-kind': isDocument(group) ? 'document' : 'record',
    });
    if (hit) node.classList.add('chat-map-hit');
    if (highlighted && !isChosen && selected.has(item.id)) node.classList.add('connected-node');
    activate(node, item.label, () => choose(item, node === document.activeElement));
    if (isChosen) {
      node.classList.add('universe-selected');
      shape('circle', { cx: p.x, cy: p.y, r: 16, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: .8, class: 'selection-ring', 'pointer-events': 'none' }, layer);
    }
    entryLabel(layer, p, { ...item, group }, isChosen ? 3 : highlighted ? 2 : 1);
  });
}

/** @param {boolean} [animate] @param {Point|null} [origin] */
function renderMap(animate = false, origin = null) {
  if (selectionLabel) {
    const selected = page?.items.find(item => item.id === chosen);
    selectionLabel.hidden = !selected;
    selectionLabel.textContent = selected ? 'Узел: ' + selected.label : '';
  }
  svg.dataset.selected = String(!!chosen);
  svg.dataset.view = focus ? 'detail' : 'overview';
  content.replaceChildren();
  content.classList.remove('scene-content');
  if (focus) drawDetails(origin);
  else {
    drawOverview();
    drawPreviews();
  }
  drawCore(content);
  if (focus) drawPaging(content);
  if (animate) {
    content.getBoundingClientRect();
    content.classList.add('scene-content');
  }
  updateLabels();
  schedulePreviews();
}

/** @param {Item} item @param {boolean} [restoreFocus] */
function choose(item, restoreFocus = false) {
  chosen = item.id;
  neighbors = [];
  mapStatus.textContent = item.label;
  saveView();
  renderMap();
  const selector = '[data-entry="' + item.id + '"]';
  if (restoreFocus) /** @type {SVGElement|null} */ (svg.querySelector(selector))?.focus();
  if (demo) return;
  const selectedPage = page;
  const query = new URLSearchParams({ group: page.group, id: String(item.id) });
  void fetchData('/api/universe/neighbors?' + query).then(result => {
    if (selectedPage !== page || chosen !== item.id) return;
    neighbors = result;
    const focused = document.activeElement === svg.querySelector(selector);
    renderMap();
    if (focused) /** @type {SVGElement|null} */ (svg.querySelector(selector))?.focus();
  }).catch(() => {});
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
  return { id: item.id, group: page.group, label: item.label, connections };
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

/** @param {Focus} target @param {number} cursor @param {number[]} stack @param {Match} [match] @param {Point|null} [origin] */
async function loadPage(target, cursor, stack, match, origin = null) {
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
    if (origin) setView(1, 0, 0);
    focus = target;
    page = result;
    after = cursor;
    history = stack;
    chosen = 0;
    neighbors = [];
    mapStatus.textContent = page.items.length ? fmt(page.items.length) + ' элементов на странице' : 'В этой категории пока нет записей.';
  } catch {
    if (token === request) mapStatus.textContent = 'Не удалось загрузить записи.';
  } finally {
    if (token === request) {
      pending = false;
      renderMap(true, loaded ? origin : null);
      if (loaded && fromMap && document.activeElement === document.body) svg.focus();
    }
  }
  if (loaded && token === request) saveView();
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

/** @param {string} name @param {number} [start] @param {number} [end] @param {Point|null} [origin] */
function open(name, start = defaults.start, end = defaults.end, origin = null) {
  const anchor = origin && { x: scale * origin.x + x, y: scale * origin.y + y };
  const arrival = anchor && { x: Math.max(-510, Math.min(510, anchor.x)), y: Math.max(-510, Math.min(510, anchor.y)) };
  if (!arrival) setView(1, 0, 0);
  void loadPage({ name, start, end }, 0, [], undefined, arrival);
}

function openOverview() {
  request++;
  pending = false;
  focus = null;
  page = null;
  history = [];
  chosen = 0;
  neighbors = [];
  mapStatus.textContent = 'Общий вид карты.';
  setView(1, 0, 0);
  renderMap(true);
  if (!overview) void loadOverview();
}

let labelFrame = 0;
/** @param {number} value @param {number} tx @param {number} ty */
function setView(value, tx, ty) {
  scale = value;
  x = tx;
  y = ty;
  scene.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + scale + ')');
  if (!labelFrame) labelFrame = requestAnimationFrame(() => {
    labelFrame = 0;
    updateLabels();
  });
  schedulePreviews();
  saveView();
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
  if (event.key === 'Escape') openOverview();
  else if (event.key === '0') setView(1, 0, 0);
  else if (event.key === '+' || event.key === '=') zoom(1.28, { x: 0, y: 0 });
  else if (event.key === '-') zoom(1 / 1.28, { x: 0, y: 0 });
  else return;
  event.preventDefault();
});

/** @param {Point} client */
function mapPoint(client) {
  const matrix = svg.getScreenCTM();
  return matrix && new DOMPoint(client.x, client.y).matrixTransform(matrix.inverse());
}

svg.addEventListener('wheel', event => {
  event.preventDefault();
  const p = mapPoint({ x: event.clientX, y: event.clientY });
  if (p) zoom(Math.exp(-event.deltaY * .001), p);
}, { passive: false });

/** @type {Map<number,{start:Point, point:Point}>} */ const pointers = new Map();
let moved = false;
svg.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointers.size >= 2) return;
  if (!pointers.size) moved = false;
  const point = { x: event.clientX, y: event.clientY };
  const node = !!/** @type {Element} */ (event.target).closest('.universe-node');
  pointers.set(event.pointerId, { start: point, point });
  if (pointers.size === 2) {
    moved = true;
    for (const id of pointers.keys()) svg.setPointerCapture(id);
  } else if (!node) svg.setPointerCapture(event.pointerId);
});

svg.addEventListener('pointermove', event => {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) return;
  const next = { x: event.clientX, y: event.clientY };
  const before = pointer.point;
  if (pointers.size === 1) {
    if (!moved && Math.hypot(next.x - pointer.start.x, next.y - pointer.start.y) < 5) return;
    if (!moved) svg.setPointerCapture(event.pointerId);
    moved = true;
    const a = mapPoint(before), b = mapPoint(next);
    if (a && b) setView(scale, x + b.x - a.x, y + b.y - a.y);
  } else {
    const other = Array.from(pointers.entries()).find(([id]) => id !== event.pointerId)[1].point;
    const previousMiddle = mapPoint({ x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 });
    const nextMiddle = mapPoint({ x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 });
    const previousDistance = Math.hypot(before.x - other.x, before.y - other.y);
    if (previousMiddle && nextMiddle && previousDistance > 1) {
      const factor = Math.hypot(next.x - other.x, next.y - other.y) / previousDistance;
      const value = Math.min(8, Math.max(.65, scale * factor));
      setView(value, nextMiddle.x - (previousMiddle.x - x) * value / scale,
        nextMiddle.y - (previousMiddle.y - y) * value / scale);
    }
  }
  pointer.point = next;
});
window.addEventListener('pointerup', event => pointers.delete(event.pointerId));
svg.addEventListener('pointercancel', event => pointers.delete(event.pointerId));
svg.addEventListener('lostpointercapture', event => {
  if (event.target === svg) pointers.delete(event.pointerId);
});
svg.addEventListener('click', event => {
  if (moved && event.detail > 0) event.stopPropagation();
}, { capture: true });

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

/** @type {Match[]} */
let matches = [];
let viewReady = false;
let saveTimer = 0;
/** @type {Map<string,Page>} */ const previewCache = new Map();
/** @type {Set<string>} */ const previewLoading = new Set();
/** @type {Set<string>} */ const previewFailed = new Set();
let previewTimer = 0;
/** @type {SVGGElement|null} */ let previewLayer = null;
/** @type {string} */ let previewSignature = '';
const ready = loadOverview();

/** @param {string} group @param {{start:number,end:number}} range */
function clusterKey(group, range) {
  return group + ':' + range.start + ':' + range.end;
}

function visibleClusters() {
  const bounds = svg.getBoundingClientRect();
  const middle = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  const matrix = scene.getScreenCTM();
  if (!matrix) return [];
  return Array.from(content.querySelectorAll('[data-cluster]'), el => {
    const node = /** @type {SVGGElement} */ (el);
    const position = { x: Number(node.dataset.x), y: Number(node.dataset.y) };
    const screen = new DOMPoint(position.x, position.y).matrixTransform(matrix);
    if (screen.x < bounds.left - 55 || screen.x > bounds.right + 55 ||
        screen.y < bounds.top - 55 || screen.y > bounds.bottom + 55) return null;
    return { key: node.dataset.cluster, group: node.dataset.group, start: Number(node.dataset.start),
      end: Number(node.dataset.end), position, distance: Math.hypot(screen.x - middle.x, screen.y - middle.y) };
  }).filter(row => row !== null).sort((a, b) => a.distance - b.distance).slice(0, 6);
}

function drawPreviews() {
  if (focus || scale < 2.55) return;
  const clusters = visibleClusters().filter(cluster => previewCache.has(cluster.key));
  const signature = clusters.map(cluster => cluster.key).join('|');
  if (previewLayer?.isConnected && signature === previewSignature) return;
  previewLayer?.remove();
  previewSignature = signature;
  previewLayer = shape('g', { class: 'overview-previews' }, content);
  for (const cluster of clusters) {
    const { group, position } = cluster;
    const color = categoryColor(group);
    const detail = previewCache.get(cluster.key);
    const nodes = detail.items.slice(0, 5);
    const positions = new Map(nodes.map((item, i) => [item.id, {
      x: position.x + 21 + (i % 2) * 23, y: position.y + (i - (nodes.length - 1) / 2) * 17,
    }]));
    for (const link of detail.links) {
      const a = positions.get(link.source), b = positions.get(link.target);
      if (a && b) shape('path', { d: `M ${xy(a)} L ${xy(b)}`, stroke: color, opacity: .65, class: 'universe-route' }, previewLayer);
    }
    for (const item of nodes) {
      const p = positions.get(item.id);
      const match = { ...item, group };
      const hit = matches.some(row => row.group === group && row.id === item.id);
      const node = entryShape(p, group, previewLayer, 4.5, { fill: '#132532', stroke: color, color,
        'stroke-width': 1.5, class: hit ? 'chat-map-hit' : '', 'data-preview-entry': item.id });
      activate(node, item.label, () => { void inspectMatch(match); });
      entryLabel(previewLayer, p, match, hit ? 2 : 1, true);
    }
  }
}

function schedulePreviews() {
  window.clearTimeout(previewTimer);
  if (focus || scale < 2.55) return;
  previewTimer = window.setTimeout(() => {
    for (const cluster of visibleClusters()) {
      const { key, group, start, end } = cluster;
      if (previewCache.has(key) || previewLoading.has(key) || previewFailed.has(key)) continue;
      const query = new URLSearchParams({ group, after: '0', start: String(start), end: String(end) }).toString();
      previewLoading.add(key);
      const result = demo ? Promise.resolve(demo.pages[query]) : fetchData('/api/universe/page?' + query);
      void result.then(data => {
        if (data) {
          previewCache.set(key, data);
          if (previewCache.size > 60) previewCache.delete(previewCache.keys().next().value);
        }
        drawPreviews();
        updateLabels();
      }).catch(() => {
        previewFailed.add(key);
        window.setTimeout(() => previewFailed.delete(key), 2000);
      }).finally(() => previewLoading.delete(key));
    }
    drawPreviews();
    updateLabels();
  }, 95);
}

function updateLabels() {
  svg.dataset.level = scale >= 2.55 ? 'entries' : scale >= 1.2 ? 'clusters' : 'overview';
  const matrix = scene.getScreenCTM();
  if (!matrix) return;
  const bounds = svg.getBoundingClientRect();
  const labels = Array.from(content.querySelectorAll('.entry-label'), node => /** @type {SVGTextElement} */ (node))
    .sort((a, b) => Number(b.dataset.priority) - Number(a.dataset.priority));
  const fontSize = String(Math.min(32, Math.max(13, 11 / Math.abs(matrix.a))));
  for (const text of labels) {
    if (text.getAttribute('font-size') !== fontSize) text.setAttribute('font-size', fontSize);
  }
  /** @type {DOMRect[]} */ const occupied = [];
  for (const text of labels) {
    const priority = Number(text.dataset.priority);
    const anchor = new DOMPoint(Number(text.dataset.anchorX), Number(text.dataset.anchorY)).matrixTransform(matrix);
    const readable = priority >= 2 || matrix.a * 13 >= 10;
    const nearby = anchor.x >= bounds.left - 6 && anchor.x <= bounds.right + 6 &&
      anchor.y >= bounds.top - 6 && anchor.y <= bounds.bottom + 6;
    if (!readable || !nearby) {
      text.dataset.visible = 'false';
      continue;
    }
    const box = text.getBoundingClientRect();
    const overlaps = occupied.some(other => box.left < other.right + 4 && box.right > other.left - 4 &&
      box.top < other.bottom + 3 && box.bottom > other.top - 3);
    text.dataset.visible = String(!overlaps || priority === 3);
    if (!overlaps || priority === 3) occupied.push(box);
  }
}

new ResizeObserver(updateLabels).observe(svg);

function currentView() {
  return { scale, x, y, focus, after, chosen, history };
}

function saveView() {
  if (!viewReady || demo) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    void apiRequest('/api/map-chat', { action: 'view', view: currentView() }).catch(() => {});
  }, 180);
}

window.addEventListener('pagehide', () => {
  if (!viewReady || demo || !saveTimer) return;
  window.clearTimeout(saveTimer);
  void fetch('/api/map-chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify({ action: 'view', view: currentView() }),
  }).catch(() => {});
});

/** @param {Match} match */
function inspectMatch(match) {
    if (indexOf(match.group) < 0) return Promise.resolve(false);
    const index = page?.group === match.group ? page.items.findIndex(item => item.id === match.id) : -1;
    if (index >= 0) {
      choose(page.items[index]);
      const p = entryPosition(index);
      if (scale > 1) setView(scale, -p.x * scale, -p.y * scale);
      svg.scrollIntoView({ block: 'nearest' });
      return Promise.resolve(true);
    }
    return loadPage({ name: match.group, start: match.id, end: match.id }, 0, [], match).then(found => {
      if (found) {
        const p = entryPosition(0);
        setView(scale, scale > 1 ? -p.x * scale : 0, scale > 1 ? -p.y * scale : 0);
      }
      return found;
    });
}

if (!demo) startCloudSettings();
startChat({
  local: !!demo,
  categoryColor,
  highlight: hits => {
    matches = hits;
    renderMap();
  },
  restore: async view => {
    await ready;
    if (view) {
      if (view.focus && indexOf(view.focus.name) >= 0) {
        await loadPage(view.focus, view.after, view.history || []);
        const selected = page?.items.find(item => item.id === view.chosen);
        if (selected) choose(selected);
      }
      setView(view.scale, view.x, view.y);
    }
    viewReady = true;
  },
  overview: () => overview,
  selection: getSelection,
  search: query => {
    if (!demo) return fetchData('/api/universe/chat-search?' + new URLSearchParams({ q: query }));
    const matches = demoFullPages.flatMap(row => row.items
      .filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
      .map(item => ({ id: item.id, group: row.group, label: item.label })));
    return Promise.resolve(matches.slice(0, 8));
  },
  inspect: inspectMatch,
});

if (demo) get('chat-source').textContent = 'Демонстрационные данные';
drawGrid();
renderMap();

export {};
