// @ts-check
import { el, get, number, post, request, table, today } from './portal.js';

/** @typedef {{id:number,name:string,position:string}} Employee */
/** @typedef {{number:string,employee:number}} Card */
/** @typedef {{id:number,make:string,model:string,plate:string,driver:number|null,summer:number,winter:number}} Vehicle */
/** @typedef {{id:number,employee:number,day:string,status:string,hours:number}} Timesheet */
/** @typedef {{id:number,vehicle:number|null,day:string,material:string,unit:string,quantity:number,price:number,card:string,amount:number,operation:string,hour:string,station:string,filename:string,imported:number}} Fuel */
/** @typedef {{id:number,filename:string,created:string,first_day:string,last_day:string,added:number,duplicates:number,returns:number,unassigned:number}} ImportRun */
/** @typedef {{vehicle:number,km:number,diesel:number,petrol:number,season:string,norm:number}} Measurement */
/** @typedef {{employees:Employee[],cards:Card[],vehicles:Vehicle[],timesheet:Timesheet[],fuel:Fuel[],cardVehicles:{card:string,vehicle:number}[], runs:ImportRun[], measurements:Measurement[], fleet:{id:number,row:(string|number|null)[]}[],runFuel?:Fuel[]}} Records */
/** @typedef {{id?:number,name?:string,position?:string,make?:string,model?:string,plate?:string,driver?:number,summer?:number,winter?:number,employee?:number,day?:string,status?:string,hours?:number,vehicle?:number,material?:string,unit?:string,quantity?:number,price?:number,card?:string}} RecordDraft */

const labels = {
  overview: { title: 'Обзор работы', description: 'Сотрудники, автопарк, табель и топливо за выбранный месяц.', add: '', kind: '' },
  employees: { title: 'Сотрудники', description: 'Водители, топливные карты и закреплённые автомобили.', add: 'Добавить сотрудника', kind: 'employee' },
  vehicles: { title: 'Автомобили', description: 'Автопарк, водители и сезонные нормы расхода.', add: 'Добавить автомобиль', kind: 'vehicle' },
  timesheet: { title: 'Табель', description: 'Рабочие дни, часы и отсутствия по сотрудникам.', add: 'Заполнить день', kind: 'timesheet' },
  fuel: { title: 'Горюче-смазочные материалы', description: 'Заправки, масла и другие материалы по автомобилям.', add: 'Добавить расход', kind: 'fuel' },
};
/** @typedef {keyof typeof labels} Section */

const dates = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'UTC' });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const month = /** @type {HTMLInputElement} */ (get('work-month'));
const editor = /** @type {HTMLDialogElement} */ (get('work-editor'));
const form = /** @type {HTMLFormElement} */ (get('work-form'));
const add = /** @type {HTMLButtonElement} */ (get('add-record'));
const save = /** @type {HTMLButtonElement} */ (get('save-record'));
const fields = get('work-fields');
const results = get('work-results');
const status = get('work-status');
const editorError = get('editor-error');
const importButton = /** @type {HTMLButtonElement} */ (get('import-fuel'));
const statementFile = /** @type {HTMLInputElement} */ (get('fuel-file'));
const array = Array.from(document.querySelectorAll('[data-section]'));
const statuses = ['Работа', 'Работа в выходной', 'Выходной', 'Отпуск', 'Больничный', 'Отсутствие'];
month.value = new URLSearchParams(location.search).get('month') || today().slice(0, 7);
if (!month.value) month.value = today().slice(0, 7);

/** @type {Records} */ let records = { employees: [], cards: [], vehicles: [], timesheet: [], fuel: [], cardVehicles: [], runs: [], measurements: [], fleet: [] };
/** @type {Section} */ let section = 'overview';
/** @type {Section} */ let editing = 'employees';
/** @type {number|null} */ let recordId = null;
let serial = 0;
let loadedMonth = month.value;
let loading = false;
let importing = false;
let bindingCard = '';
let extraMode = '';
let mobileWeek = 0;
let fuelView = 'journal';
let selectedRun = null;
let detailToken = 0;
const detailPanel = get('work-detail');
const scheduleButton = /** @type {HTMLButtonElement} */ (get('schedule'));
const exportLink = /** @type {HTMLAnchorElement} */ (get('export-fuel'));

/** @param {number} id */
const employeeName = id => records.employees.find(entry => entry.id === id)?.name || '—';
/** @param {Vehicle} row */
const vehicleName = row => [row.make, row.model, row.plate].filter(Boolean).join(' · ');
/** @param {string} day */
const dayText = day => dates.format(new Date(day + 'T00:00:00Z'));

/** @param {[string,string|number][]} values */
function metrics(values) {
  const panel = get('work-metrics');
  panel.replaceChildren();
  for (const [label, value] of values) {
    const card = el('div', '', 'metric');
    card.append(el('span', label), el('strong', typeof value === 'number' ? number.format(value) : value));
    panel.append(card);
  }
}

/** @param {HTMLTableSectionElement} body @param {(string|number)[]} cells @param {RecordDraft} item */
function drawRow(body, cells, item) {
  const row = body.insertRow();
  cells.forEach((cell, index) => {
    const td = row.insertCell();
    const value = typeof cell === 'number' ? number.format(cell) : cell;
    if (!index && (section === 'employees' || section === 'vehicles')) {
      const open = el('button', value, 'row-action entity-link');
      open.type = 'button';
      open.addEventListener('click', () => { void showDetail(item, open); });
      td.append(open);
    } else td.textContent = value;
  });
  const button = el('button', 'Изменить', 'row-action');
  button.type = 'button';
  button.setAttribute('aria-label', 'Изменить: ' + cells.slice(0, section === 'fuel' ? 2 : 1).join(' · '));
  button.addEventListener('click', () => showEditor(item));
  row.insertCell().append(button);
}

/** @param {string} period */
function calendar(period) {
  const first = new Date(period + '-01T00:00:00Z');
  const limit = new Date(first);
  limit.setUTCMonth(first.getUTCMonth() + 1);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Math.round((limit.valueOf() - first.valueOf()) / 86400000);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(first.valueOf() + index * 86400000);
    return { date: date.toISOString().slice(0, 10), value: index + 1,
      weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6, week: Math.floor((index + offset) / 7) };
  });
}

/** @param {Employee[]} employees @param {Timesheet[]} entries */
function renderTimesheet(employees, entries) {
  const calendarDays = calendar(month.value);
  const marks = { 'Выходной': 'В', 'Отпуск': 'ОТ', 'Больничный': 'Б', 'Отсутствие': 'Н' };
  const { shell, body } = table(['Сотрудник', 'Часы', ...calendarDays.map(day => String(day.value))]);
  shell.classList.add('timesheet-shell');
  shell.tabIndex = 0;
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', 'Табель по дням месяца');
  const lookup = new Map(entries.map(entry => [entry.employee + ':' + entry.day, entry]));
  const totals = new Map();
  const currentDay = today();
  for (const entry of entries) totals.set(entry.employee, (totals.get(entry.employee) || 0) + entry.hours);
  const header = shell.querySelector('thead tr');
  calendarDays.forEach((day, index) => {
    const cell = /** @type {HTMLElement} */ (header.children[index + 2]);
    cell.dataset.week = String(day.week);
    cell.classList.toggle('weekend', day.weekend);
  });
  for (const employee of employees) {
    const row = body.insertRow();
    const name = el('th', employee.name);
    name.scope = 'row';
    row.append(name);
    row.insertCell().textContent = number.format(totals.get(employee.id) || 0);
    for (const info of calendarDays) {
      const entry = lookup.get(employee.id + ':' + info.date);
      const code = entry?.status === 'Работа в выходной' ? 'РВ ' + number.format(entry.hours)
        : entry?.status === 'Работа' ? number.format(entry.hours) : entry ? marks[entry.status] : '·';
      const button = el('button', code, 'day-cell');
      button.type = 'button';
      if (entry) button.classList.add('filled-day');
      if (!entry && !info.weekend && info.date <= currentDay) button.classList.add('missing');
      button.setAttribute('aria-label', [employee.name, dayText(info.date), entry?.status || 'Заполнить день'].join(' · '));
      button.addEventListener('click', () => showEditor(entry || { day: info.date, employee: employee.id }));
      const cell = row.insertCell();
      cell.dataset.week = String(info.week);
      cell.classList.toggle('weekend', info.weekend);
      cell.append(button);
    }
  }
  const controls = el('div', '', 'week-controls');
  const previous = el('button', '‹', 'button');
  const next = el('button', '›', 'button');
  const caption = el('span');
  previous.setAttribute('aria-label', 'Предыдущая неделя');
  next.setAttribute('aria-label', 'Следующая неделя');
  const last = calendarDays[calendarDays.length - 1].week;
  function showWeek() {
    mobileWeek = Math.max(0, Math.min(mobileWeek, last));
    const days = calendarDays.filter(day => day.week === mobileWeek);
    caption.textContent = days[0].value + '–' + days[days.length - 1].value;
    previous.disabled = mobileWeek === 0;
    next.disabled = mobileWeek === last;
    for (const cell of shell.querySelectorAll('[data-week]')) {
      cell.setAttribute('data-week-hidden', String(Number(cell.getAttribute('data-week')) !== mobileWeek));
    }
    shell.scrollLeft = 0;
  }
  previous.addEventListener('click', () => { mobileWeek--; showWeek(); });
  next.addEventListener('click', () => { mobileWeek++; showWeek(); });
  showWeek();
  controls.append(previous, caption, next);
  const legend = el('p', 'РВ — работа в выходной · В — выходной · ОТ — отпуск · Б — больничный · Н — отсутствие. Жёлтые клетки — незаполненные будни.', 'timesheet-legend');
  results.append(controls, legend, shell);
}

function dashboard() {
  const { employees, cards, vehicles, timesheet, fuel } = records;
  const required = calendar(month.value).filter(day => !day.weekend && day.date <= today());
  const dates = new Set(required.map(day => day.date));
  const filled = timesheet.filter(row => dates.has(row.day)).length;
  const grid = el('div', '', 'dashboard-grid');
  const items = [
    ['employees', 'Сотрудники', employees.length, 'Топливных карт: ' + cards.length, '#82b7db'],
    ['vehicles', 'Автомобили', vehicles.length, 'Без водителя: ' + vehicles.filter(row => !row.driver).length, '#71d8cd'],
    ['timesheet', 'Табель', required.length * employees.length - filled, 'Незаполненные будни', '#dcac75'],
    ['fuel', 'ГСМ', fuel.length, 'Без автомобиля: ' + fuel.filter(row => row.vehicle === null).length, '#c6a7e1'],
  ];
  for (const [route, title, value, note, accent] of items) {
    const item = el('a', '', 'dashboard-card');
    item.href = '#' + route;
    item.style.setProperty('--accent', String(accent));
    item.append(el('h2', String(title)), el('strong', number.format(Number(value))), el('small', String(note)));
    grid.append(item);
  }
  results.append(grid);
}

/** @param {HTMLElement} target @param {[string,string][]} rows */
function detailFacts(target, rows) {
  const list = el('dl');
  for (const [label, value] of rows) list.append(el('dt', label), el('dd', value || '—'));
  target.append(list);
}

/** @type {HTMLElement|null} */ let detailTrigger = null;
/** @param {boolean} [focus] */
function closeDetail(focus = false) {
  detailToken++;
  detailPanel.hidden = true;
  if (focus && detailTrigger?.isConnected) detailTrigger.focus();
}
get('close-work-detail').addEventListener('click', () => closeDetail(true));

/** @param {RecordDraft} item @param {HTMLElement} trigger */
async function showDetail(item, trigger) {
  const token = ++detailToken;
  detailTrigger = trigger;
  const area = get('work-detail-body');
  const heading = get('work-detail-title');
  const edit = /** @type {HTMLButtonElement} */ (get('edit-detail'));
  edit.onclick = () => { closeDetail(); showEditor(item); };
  area.replaceChildren();
  detailPanel.hidden = false;
  get('close-work-detail').focus({ preventScroll: true });
  if (matchMedia('(max-width: 1040px)').matches) detailPanel.scrollIntoView({ block: 'nearest' });
  if (section === 'employees') {
    heading.textContent = item.name;
    detailFacts(area, [['Должность', item.position], ['Карты', records.cards
      .filter(row => row.employee === item.id).map(row => row.number).join(', ')],
    ['Автомобили', records.vehicles.filter(row => row.driver === item.id).map(vehicleName).join(', ')]]);
    return;
  }
  const vehicle = records.vehicles.find(row => row.id === item.id);
  heading.textContent = vehicleName(vehicle);
  detailFacts(area, [['Водитель', employeeName(vehicle.driver)], ['Лето', number.format(vehicle.summer) + ' л/100 км'],
    ['Зима', number.format(vehicle.winter) + ' л/100 км']]);
  area.append(el('h3', 'Последние операции'));
  try {
    const fuel = /** @type {Fuel[]} */ (await request('/api/work?' + new URLSearchParams({ vehicle: String(vehicle.id) })));
    if (token !== detailToken) return;
    if (!fuel.length) area.append(el('p', 'Операций пока нет.'));
    const list = el('ul');
    for (const row of fuel) list.append(el('li', dayText(row.day) + ' · ' + row.material + ' · ' + number.format(row.quantity) + ' ' + row.unit));
    if (fuel.length) area.append(list);
  } catch (error) {
    if (token === detailToken) area.append(el('p', error.message));
  }
}

/** @param {Fuel[]} fuel @param {Vehicle[]} vehicles */
function drawCardTotals(fuel, vehicles) {
  /** @type {Map<string,{issued:number,returned:number,amount:number,unassigned:number,imported:boolean,cars:Set<number>}>} */
  const totals = new Map();
  for (const row of fuel) {
    if (!row.card || row.unit !== 'л') continue;
    const total = totals.get(row.card) || { issued: 0, returned: 0, amount: 0, unassigned: 0, imported: false, cars: new Set() };
    if (row.quantity < 0) total.returned -= row.quantity;
    else total.issued += row.quantity;
    total.amount += row.amount;
    total.imported ||= !!row.imported;
    if (row.vehicle) total.cars.add(row.vehicle);
    else total.unassigned++;
    totals.set(row.card, total);
  }
  if (!totals.size) return;
  const { shell, body } = table(['Топливная карта', 'Сотрудник по карте', 'Заправлено, л', 'Возвраты, л', 'Итого, л', 'Сумма', 'Автомобили']);
  for (const [card, total] of Array.from(totals).sort(([a], [b]) => a.localeCompare(b))) {
    const tr = body.insertRow();
    const owner = records.cards.find(entry => entry.number === card);
    for (const value of [card, owner ? employeeName(owner.employee) : '—', number.format(total.issued),
      number.format(total.returned), number.format(total.issued - total.returned), money.format(total.amount)]) {
      tr.insertCell().textContent = value;
    }
    const cars = tr.insertCell();
    const names = vehicles.filter(row => total.cars.has(row.id)).map(vehicleName);
    if (total.unassigned) names.push('Без авто: ' + number.format(total.unassigned));
    cars.append(el('span', names.join(', ') || '—'));
    if (total.imported && vehicles.length) {
      const choose = el('button', 'Привязать авто', 'row-action card-action');
      choose.type = 'button';
      choose.setAttribute('aria-label', 'Привязать авто к карте ' + card);
      choose.addEventListener('click', () => showCardBinding(card));
      cars.append(choose);
    }
  }
  results.append(el('h2', 'Итоги по топливным картам', 'table-heading'), shell);
}

/** @param {string} card */
function showCardBinding(card) {
  bindingCard = card;
  extraMode = '';
  fields.replaceChildren();
  editorError.textContent = '';
  get('editor-title').textContent = 'Привязка карты ' + card;
  const options = records.vehicles.map(row => /** @type {[number,string]} */ ([row.id, vehicleName(row)]));
  const current = records.cardVehicles.find(row => row.card === card)?.vehicle ?? '';
  select('vehicle', 'Автомобиль', current, [['', 'Авто определяется по водителю'], ...options]);
  fields.append(el('p', 'Привязка применяется к новым и ещё не распределённым операциям выписки.', 'field-note'));
  editor.showModal();
  fields.querySelector('select')?.focus();
}

function fuelToolbar() {
  const tools = el('div', '', 'section-tools');
  const groups = [['journal', 'Журнал'], ['queue', 'Без автомобиля'], ['history', 'История загрузок'], ['fleet', 'Сводка по авто']];
  for (const [target, name] of groups) {
    const button = el('button', name, 'button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(target === fuelView));
    button.addEventListener('click', () => {
      fuelView = target;
      selectedRun = null;
      render();
      const next = Array.from(results.querySelectorAll('.section-tools button')).find(node => node.textContent === name);
      /** @type {HTMLElement|null} */ (next)?.focus();
    });
    tools.append(button);
  }
  results.append(tools);
}

function renderHistory() {
  if (!records.runs.length) {
    results.append(el('p', 'Загрузите выписку, чтобы появилась история.', 'empty'));
    return;
  }
  const { shell, body } = table(['Выписка', 'Период', 'Добавлено', 'Повторы', 'Возвраты', 'Без автомобиля']);
  for (const run of records.runs) {
    const row = body.insertRow();
    const open = el('button', run.filename, 'row-action');
    open.type = 'button';
    open.addEventListener('click', () => {
      selectedRun = run.id;
      fuelView = 'journal';
      void load();
    });
    row.insertCell().append(open, el('small', run.created || 'Импортировано до появления истории', 'operation-source'));
    for (const value of [dayText(run.first_day) + ' — ' + dayText(run.last_day), run.added, run.duplicates, run.returns, run.unassigned]) {
      row.insertCell().textContent = String(value);
    }
  }
  results.append(shell);
}

/** @param {Vehicle[]} vehicles */
function renderFleet(vehicles) {
  const enter = el('button', 'Внести пробег и расход', 'button primary');
  enter.type = 'button';
  enter.disabled = !vehicles.length;
  enter.addEventListener('click', () => showMeasurement());
  results.append(enter);
  if (!vehicles.length) {
    results.append(el('p', 'Добавьте автомобили, чтобы сформировать сводку.', 'empty'));
    return;
  }
  const { shell, body } = table(['Автомобиль', 'Водитель', 'Заправка ДТ / бензин, л', 'Возвраты ДТ / бензин, л', 'Прочее топливо, л', 'Сумма ГСМ',
    'Пробег, км', 'Расход факт, л/100 км', 'Норма, л/100 км', 'Отклонение, л', '']);
  const fmt = (/** @type {string|number|null} */ value) => value === null ? '—' : number.format(Number(value));
  for (const entry of records.fleet) {
    const [plate, title, driver, diesel, dieselReturns, petrol, petrolReturns, other, cost,
      km, , , actual, season, norm, , difference] = entry.row;
    const row = body.insertRow();
    const figures = [String(title) + (plate ? ' · ' + plate : ''), driver || '—',
      fmt(diesel) + ' / ' + fmt(petrol), fmt(dieselReturns) + ' / ' + fmt(petrolReturns),
      fmt(other), money.format(Number(cost)), fmt(km), fmt(actual), norm === null ? '—' : fmt(norm) + ' · ' + season,
      fmt(difference)];
    for (const value of figures) row.insertCell().textContent = String(value);
    const edit = el('button', 'Пробег и расход', 'row-action');
    edit.type = 'button';
    edit.addEventListener('click', () => showMeasurement(entry.id));
    row.insertCell().append(edit);
  }
  results.append(el('h2', 'Сводка по автомобилям за месяц', 'table-heading'), shell);
  const missing = records.fuel.filter(row => row.vehicle === null).length;
  if (missing) results.append(el('p', 'Операций без автомобиля: ' + missing + '. Их можно распределить в очереди.', 'status'));
}

/** @param {Vehicle[]} vehicles */
function renderFuel(vehicles) {
  fuelToolbar();
  if (fuelView === 'history' || fuelView === 'fleet') {
    metrics([]);
    if (fuelView === 'history') renderHistory();
    else renderFleet(vehicles);
    return;
  }
  const fuel = fuelView === 'queue' ? records.fuel.filter(row => row.vehicle === null)
    : selectedRun ? records.runFuel || [] : records.fuel;
  if (selectedRun) {
    const run = records.runs.find(row => row.id === selectedRun);
    if (run) results.append(el('p', 'Операции выписки: ' + run.filename, 'status'));
  }
  const total = fuel.reduce((sum, row) => sum + row.amount, 0);
  metrics([['Операции', fuel.length], ['Итого, л', fuel.reduce((sum, row) => sum + (row.unit === 'л' ? row.quantity : 0), 0)],
    ['Масса, кг', fuel.reduce((sum, row) => sum + (row.unit === 'кг' ? row.quantity : 0), 0)], ['Сумма', money.format(total)]]);
  if (!fuel.length) { results.append(el('p', 'В этом списке нет операций.', 'empty')); return; }
  drawCardTotals(fuel, vehicles);
  const { shell, body } = table(['Дата', 'Автомобиль', 'Материал', 'Количество', 'Цена за ед.', 'Сумма', 'Топливная карта', '']);
  for (const item of fuel) {
    const vehicle = vehicles.find(row => row.id === item.vehicle);
    const date = dayText(item.day) + (item.hour ? ' · ' + item.hour : '');
    const values = [date, vehicle ? vehicleName(vehicle) : 'Без автомобиля', item.material,
      number.format(item.quantity) + ' ' + item.unit, money.format(item.price), money.format(item.amount), item.card || '—'];
    if (item.imported) {
      const row = body.insertRow();
      for (const value of values) row.insertCell().textContent = value;
      const source = row.insertCell();
      source.append(el('span', item.operation), el('small', [item.station, item.filename].filter(Boolean).join(' · '), 'operation-source'));
    } else {
      drawRow(body, values, item);
    }
  }
  results.append(el('h2', 'Журнал операций', 'table-heading'), shell);
}

function render() {
  get('work-title').textContent = labels[section].title;
  get('work-description').textContent = labels[section].description;
  importButton.hidden = section !== 'fuel';
  importButton.disabled = importing;
  add.hidden = section === 'overview';
  scheduleButton.hidden = section !== 'timesheet';
  scheduleButton.disabled = !records.employees.length;
  exportLink.hidden = section !== 'fuel';
  exportLink.href = '/api/work/export?' + new URLSearchParams({ month: month.value });
  get('month-row').hidden = section === 'employees' || section === 'vehicles';
  add.textContent = labels[section].add;
  for (const link of array) {
    if (link.getAttribute('data-section') === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  results.replaceChildren();
  const { employees, vehicles, cards, timesheet, fuel } = records;
  add.disabled = loading || section === 'timesheet' && !employees.length || section === 'fuel' && !vehicles.length;
  if (section === 'overview') {
    metrics([]);
    dashboard();
    return;
  }
  const rows = records[section];
  const empty = () => results.append(el('p',
    section === 'timesheet' && !employees.length ? 'Сначала добавьте сотрудника.' :
      section === 'fuel' && !vehicles.length ? 'Загрузите выписку. Чтобы внести расход вручную, добавьте автомобиль.' :
        'Здесь пока нет записей.', 'empty'));

  if (section === 'employees') {
    metrics([['Сотрудники', employees.length], ['Топливные карты', cards.length]]);
    if (!rows.length) return empty();
    const { shell, body } = table(['ФИО', 'Должность', 'Топливные карты', 'Автомобили', '']);
    for (const item of employees) drawRow(body, [
      item.name, item.position || '—', cards.filter(row => row.employee === item.id).map(row => row.number).join(', ') || '—',
      vehicles.filter(row => row.driver === item.id).map(vehicleName).join(', ') || '—',
    ], item);
    results.append(shell);
  } else if (section === 'vehicles') {
    metrics([['Автомобили', vehicles.length], ['Назначен водитель', vehicles.filter(row => row.driver).length]]);
    if (!rows.length) return empty();
    const { shell, body } = table(['Автомобиль', 'Водитель', 'Лето, л/100 км', 'Зима, л/100 км', '']);
    for (const item of vehicles) drawRow(body, [vehicleName(item), employeeName(item.driver), item.summer, item.winter], item);
    results.append(shell);
  } else if (section === 'timesheet') {
    metrics([['Рабочие дни', timesheet.filter(row => row.status.startsWith('Работа')).length],
      ['Всего часов', timesheet.reduce((sum, row) => sum + row.hours, 0)]]);
    if (!employees.length) return empty();
    renderTimesheet(employees, timesheet);
  } else {
    renderFuel(vehicles);
  }
}

/** @param {string} [message] */
async function load(message = '') {
  const token = ++serial;
  const targetMonth = month.value || loadedMonth;
  loading = true;
  add.disabled = true;
  status.textContent = 'Загрузка…';
  try {
    const parameters = new URLSearchParams({ month: targetMonth });
    if (selectedRun) parameters.set('run', String(selectedRun));
    const data = await request('/api/work?' + parameters);
    if (token !== serial) return;
    if (loadedMonth !== targetMonth) mobileWeek = 0;
    loadedMonth = targetMonth;
    const url = new URL(location.href);
    url.searchParams.set('month', targetMonth);
    history.replaceState(null, '', url);
    records = data;
    loading = false;
    status.textContent = message;
    render();
  } catch (error) {
    if (token === serial) {
      loading = false;
      month.value = loadedMonth;
      status.textContent = error.message;
      render();
    }
  }
}

/** @param {string} name @param {string} title @param {string|number} value @param {Partial<HTMLInputElement>} [options] */
function input(name, title, value, options = {}) {
  const label = el('label', title);
  const field = el('input');
  Object.assign(field, { name, value: String(value), ...options });
  label.append(field);
  fields.append(label);
  return field;
}

/** @param {string} name @param {string} title @param {string|number} value @param {[string|number,string][]} choices @param {boolean} [required] */
function select(name, title, value, choices, required = false) {
  const label = el('label', title);
  const field = el('select');
  field.name = name;
  field.setAttribute('aria-label', title);
  field.required = required;
  for (const [id, name] of choices) field.add(new Option(name, String(id)));
  field.value = String(value);
  label.append(field);
  fields.append(label);
  return field;
}

/** @param {RecordDraft} item */
function employeeFields(item) {
  input('name', 'ФИО', item.name || '', { required: true, maxLength: 150 });
  input('position', 'Должность', item.position || '', { maxLength: 100 });
  const label = el('label', 'Номера топливных карт, по одному в строке');
  const cards = el('textarea');
  cards.name = 'cards';
  cards.rows = 3;
  cards.maxLength = 1640;
  cards.value = records.cards.filter(card => card.employee === item.id).map(card => card.number).join('\n');
  label.append(cards);
  fields.append(label);
  const available = records.vehicles.filter(row => !row.driver || row.driver === item.id);
  if (!available.length) {
    fields.append(el('p', 'Свободных автомобилей пока нет. Назначение можно изменить в разделе «Автомобили».', 'field-note'));
    return;
  }
  const set = el('fieldset', '', 'assignment');
  set.append(el('legend', 'Закреплённые автомобили'));
  for (const row of available) {
    const label = el('label');
    const box = el('input');
    Object.assign(box, { type: 'checkbox', name: 'vehicles', value: String(row.id), checked: row.driver === item.id });
    label.append(box, vehicleName(row));
    set.append(label);
  }
  fields.append(set);
}

/** @param {RecordDraft} [item] */
function showEditor(item = {}) {
  bindingCard = '';
  extraMode = '';
  editing = section;
  recordId = item.id ?? null;
  fields.replaceChildren();
  editorError.textContent = '';
  get('editor-title').textContent = recordId ? 'Изменить запись' : labels[section].add;
  if (section === 'employees') {
    employeeFields(item);
  } else if (section === 'vehicles') {
    input('make', 'Марка', item.make || '', { required: true, maxLength: 80 });
    input('model', 'Модель', item.model || '', { required: true, maxLength: 80 });
    input('plate', 'Госномер', item.plate || '', { maxLength: 30 });
    select('driver', 'Водитель', item.driver ?? '', [['', 'Без назначения'], ...records.employees.map(row => /** @type {[number,string]} */ ([row.id, row.name]))]);
    input('summer', 'Летняя норма, л/100 км', item.summer ?? '', { type: 'number', min: '.01', max: '1000', step: '.01', required: true });
    input('winter', 'Зимняя норма, л/100 км', item.winter ?? '', { type: 'number', min: '.01', max: '1000', step: '.01', required: true });
  } else {
    const defaultDay = today().startsWith(month.value) ? today() : month.value + '-01';
    input('day', 'Дата', item.day || defaultDay, { type: 'date', required: true });
    if (section === 'timesheet') {
      select('employee', 'Сотрудник', item.employee ?? '', [['', 'Выберите сотрудника'], ...records.employees.map(row => /** @type {[number,string]} */ ([row.id, row.name]))], true);
      const status = select('status', 'Статус дня', item.status || 'Работа', statuses.map(value => [value, value]), true);
      const hours = input('hours', 'Часы', item.hours ?? 8, { type: 'number', min: '0', max: '24', step: '.01', required: true });
      const update = () => {
        hours.disabled = !status.value.startsWith('Работа');
        if (hours.disabled) hours.value = '0';
      };
      status.addEventListener('change', update);
      update();
    } else {
      select('vehicle', 'Автомобиль', item.vehicle ?? '', [['', 'Выберите автомобиль'], ...records.vehicles.map(row => /** @type {[number,string]} */ ([row.id, vehicleName(row)]))], true);
      input('material', 'Материал', item.material || '', { placeholder: 'Например, дизель или моторное масло', maxLength: 80, required: true });
      select('unit', 'Единица измерения', item.unit || 'л', [['л', 'Литры'], ['кг', 'Килограммы']], true);
      input('quantity', 'Количество', item.quantity ?? '', { type: 'number', min: '.001', max: '1000000', step: '.001', required: true });
      input('price', 'Цена за единицу, ₽', item.price ?? '', { type: 'number', min: '0', max: '1000000', step: '.01', required: true });
      /** @type {[string,string][]} */ const cardChoices = [['', 'Без топливной карты']];
      for (const card of records.cards) cardChoices.push([card.number, card.number + ' · ' + employeeName(card.employee)]);
      if (item.card && !records.cards.some(card => card.number === item.card)) cardChoices.push([item.card, item.card + ' · из журнала']);
      select('card', 'Топливная карта', item.card || '', cardChoices);
    }
  }
  editor.showModal();
  /** @type {HTMLElement|null} */ (fields.querySelector('input, select, textarea'))?.focus();
}

/** @param {string} mode @param {string} title */
function prepareExtra(mode, title) {
  bindingCard = '';
  extraMode = mode;
  fields.replaceChildren();
  editorError.textContent = '';
  get('editor-title').textContent = title;
}

scheduleButton.addEventListener('click', () => {
  prepareExtra('schedule', 'Заполнить неделю');
  const options = records.employees.map(row => /** @type {[number,string]} */ ([row.id, row.name]));
  select('employee', 'Сотрудник', '', [['', 'Выберите сотрудника'], ...options], true);
  const start = today().startsWith(month.value) ? today() : month.value + '-01';
  const last = new Date(start + 'T00:00:00Z');
  last.setUTCDate(last.getUTCDate() + 6);
  input('start', 'С даты', start, { type: 'date', required: true });
  input('end', 'По дату', last.toISOString().slice(0, 10), { type: 'date', required: true });
  input('hours', 'Часов в день', 8, { type: 'number', min: '.01', max: '24', step: '.01', required: true });
  const label = el('label', 'Включить выходные', 'inline-check');
  const box = el('input');
  box.type = 'checkbox';
  box.name = 'weekends';
  label.prepend(box);
  fields.append(label, el('p', 'Заполненные дни, в том числе отпуск и больничный, сохраняются.', 'field-note'));
  editor.showModal();
  fields.querySelector('select')?.focus();
});

/** @param {number} [id] */
function showMeasurement(id) {
  prepareExtra('measurement', 'Пробег и фактический расход');
  const options = records.vehicles.map(row => /** @type {[number,string]} */ ([row.id, vehicleName(row)]));
  const vehicle = select('vehicle', 'Автомобиль', id ?? '', [['', 'Выберите автомобиль'], ...options], true);
  const numberSettings = { type: 'number', min: '0', max: '1000000', step: '.01', required: true };
  const km = input('km', 'Пробег, км', '', numberSettings);
  const diesel = input('diesel', 'Фактический расход ДТ, л', 0, numberSettings);
  const petrol = input('petrol', 'Фактический расход бензина, л', 0, numberSettings);
  const season = select('season', 'Сезон для нормы', 'Лето', [['Лето', 'Лето'], ['Зима', 'Зима']], true);
  function update() {
    const measure = records.measurements.find(row => row.vehicle === Number(vehicle.value));
    km.value = measure ? String(measure.km) : '';
    diesel.value = String(measure?.diesel ?? 0);
    petrol.value = String(measure?.petrol ?? 0);
    season.value = measure?.season || 'Лето';
  }
  vehicle.addEventListener('change', update);
  update();
  fields.append(el('p', 'Укажите фактический расход за выбранный месяц по путевым листам или замерам.', 'field-note'));
  editor.showModal();
  (id ? km : vehicle).focus();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (save.disabled) return;
  save.disabled = true;
  editorError.textContent = '';
  const values = new FormData(form);
  if (extraMode) {
    try {
      const data = Object.fromEntries(values);
      const result = await post('/api/work', extraMode === 'schedule' ? {
        ...data, kind: extraMode, employee: Number(data.employee), hours: Number(data.hours), weekends: values.has('weekends'),
      } : {
        ...data, kind: extraMode, month: month.value, vehicle: Number(data.vehicle),
        km: Number(data.km), diesel: Number(data.diesel), petrol: Number(data.petrol),
      });
      editor.close();
      await load(extraMode === 'schedule' ? 'Заполнено дней: ' + result.added + '. Сохранено прежних отметок: ' + result.skipped + '.'
        : 'Пробег и расход сохранены.');
    } catch (error) {
      editorError.textContent = error.message;
    } finally {
      save.disabled = false;
    }
    return;
  }
  if (bindingCard) {
    try {
      const result = await post('/api/work', { kind: 'fuel-bind-card', card: bindingCard, vehicle: values.get('vehicle') ? Number(values.get('vehicle')) : null });
      editor.close();
      await load('Привязка карты сохранена. Распределено операций: ' + result.attached + '.');
    } catch (error) {
      editorError.textContent = error.message;
    } finally {
      save.disabled = false;
    }
    return;
  }
  const payload = Object.fromEntries(values);
  payload.kind = labels[editing].kind;
  const date = values.get('day');
  const data = {
    ...payload, id: recordId,
    cards: String(values.get('cards') || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    vehicles: values.getAll('vehicles').map(Number),
    driver: values.get('driver') ? Number(values.get('driver')) : null,
    employee: Number(values.get('employee')), vehicle: Number(values.get('vehicle')),
    summer: Number(values.get('summer')), winter: Number(values.get('winter')),
    hours: Number(values.get('hours')), quantity: Number(values.get('quantity')), price: Number(values.get('price')),
  };
  try {
    await post('/api/work', data);
    if (typeof date === 'string') month.value = date.slice(0, 7);
    editor.close();
    await load('Запись сохранена.');
  } catch (error) {
    editorError.textContent = error.message;
  } finally {
    save.disabled = false;
  }
});
importButton.addEventListener('click', () => statementFile.click());
statementFile.addEventListener('change', async () => {
  const file = statementFile.files[0];
  if (!file || importing) return;
  importing = importButton.disabled = true;
  status.textContent = 'Читаю выписку…';
  try {
    const query = new URLSearchParams({ name: file.name });
    const result = await request('/api/work/fuel-import?' + query, { method: 'POST', body: file });
    fuelView = 'journal';
    selectedRun = null;
    if (!result.months.includes(month.value)) month.value = result.months[0];
    await load('Добавлено операций: ' + result.added + '. Повторов: ' + result.duplicates + '.');
  } catch (error) {
    status.textContent = error.message;
  } finally {
    importing = importButton.disabled = false;
    statementFile.value = '';
  }
});
add.addEventListener('click', () => showEditor());
month.addEventListener('change', () => {
  if (month.value) void load();
  else month.value = loadedMonth;
});
function route() {
  const name = location.hash.slice(1);
  section = Object.prototype.hasOwnProperty.call(labels, name) ? /** @type {Section} */ (name) : 'overview';
  closeDetail();
  render();
}
window.addEventListener('hashchange', route);
route();
void load();
