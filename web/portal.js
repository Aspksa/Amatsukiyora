// @ts-check
/** @param {string} id */
export const get = id => document.getElementById(id);

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [text] @param {string} [className] @returns {HTMLElementTagNameMap[K]} */
export function el(tag, text = '', className = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** @param {string} path @param {RequestInit} [options] */
export async function request(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие.');
  return data;
}

/** @param {string} path @param {object} data */
export function post(path, data) {
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

export const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
export const today = () => new Intl.DateTimeFormat('sv-SE').format(new Date());

/** @param {string[]} columns */
export function table(columns) {
  const shell = el('div', '', 'table-shell');
  const table = el('table');
  const head = table.createTHead().insertRow();
  for (const column of columns) {
    const cell = el('th', column);
    cell.scope = 'col';
    head.append(cell);
  }
  shell.append(table);
  return { shell, body: table.createTBody() };
}

for (const button of document.querySelectorAll('.close-dialog')) {
  button.addEventListener('click', () => button.closest('dialog')?.close());
}
