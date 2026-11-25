// @ts-check
import { el, get, number, post, request, table } from './portal.js';

/** @typedef {{name:string,path:string,folder:boolean,size:number,modified:number}} FileRow */
const results = get('file-results');
const status = get('file-status');
const search = /** @type {HTMLInputElement} */ (get('file-search'));
const sort = /** @type {HTMLSelectElement} */ (get('sort'));
const input = /** @type {HTMLInputElement} */ (get('file-input'));
const folderDialog = /** @type {HTMLDialogElement} */ (get('folder-dialog'));
const folderForm = /** @type {HTMLFormElement} */ (get('folder-form'));
const fileDialog = get('file-dialog');
const picture = /** @type {HTMLImageElement} */ (get('file-image'));
const pdf = /** @type {HTMLIFrameElement} */ (get('file-pdf'));
/** @type {HTMLElement|null} */ let previewTrigger = null;
const download = /** @type {HTMLAnchorElement} */ (get('download'));
const updated = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
const collator = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' });

let folder = new URLSearchParams(location.search).get('folder') || '';
let view = 'list';
let version = 0;
let previewVersion = 0;
let searchTimer = 0;
let busy = false;
let truncated = false;
/** @type {FileRow[]} */ let items = [];

/** @param {number} bytes */
function sizeText(bytes) {
  if (bytes < 1024) return number.format(bytes) + ' Б';
  if (bytes < 1024 * 1024) return number.format(Math.round(bytes / 102.4) / 10) + ' КиБ';
  return number.format(Math.round(bytes / (1024 * 102.4)) / 10) + ' МиБ';
}

/** @param {string} next */
function navigate(next) {
  window.clearTimeout(searchTimer);
  closePreview(false);
  folder = next;
  search.value = '';
  history.pushState(null, '', next ? '?' + new URLSearchParams({ folder: next }) : location.pathname);
  void load();
}

function breadcrumbs() {
  const parts = folder ? folder.split('/') : [];
  const trail = get('breadcrumbs');
  trail.replaceChildren();
  ['Все файлы', ...parts].forEach((caption, index) => {
    if (index) trail.append(el('span', '/'));
    if (index === parts.length) {
      trail.append(el('span', caption));
    } else {
      const button = el('button', caption);
      button.type = 'button';
      button.addEventListener('click', () => navigate(parts.slice(0, index).join('/')));
      trail.append(button);
    }
  });
}

/** @param {boolean} [focus] */
function closePreview(focus = true) {
  previewVersion++;
  fileDialog.hidden = true;
  picture.removeAttribute('src');
  pdf.removeAttribute('src');
  if (focus && previewTrigger?.isConnected) previewTrigger.focus();
}
get('close-file-preview').addEventListener('click', () => closePreview());

/** @param {FileRow} item @param {HTMLElement} trigger */
async function openFile(item, trigger) {
  if (item.folder) return navigate(item.path);
  closePreview(false);
  previewTrigger = trigger;
  const token = previewVersion;
  get('file-title').textContent = item.name;
  get('file-meta').textContent = sizeText(item.size) + ' · ' + updated.format(new Date(item.modified * 1000));
  const preview = get('file-preview');
  const notice = get('file-preview-status');
  preview.hidden = true;
  preview.textContent = '';
  notice.textContent = 'Загрузка предпросмотра…';
  const url = '/api/disk/file?' + new URLSearchParams({ path: item.path });
  download.href = url;
  download.download = item.name;
  picture.hidden = pdf.hidden = true;
  fileDialog.hidden = false;
  get('close-file-preview').focus({ preventScroll: true });
  if (matchMedia('(max-width: 1040px)').matches) fileDialog.scrollIntoView({ block: 'nearest' });
  if (/\.pdf$/i.test(item.name)) {
    pdf.src = url + '&preview=inline';
    pdf.hidden = false;
    notice.textContent = '';
    return;
  }
  if (/\.(png|jpe?g|gif|webp)$/i.test(item.name)) {
    picture.alt = item.name;
    picture.onerror = () => {
      if (token !== previewVersion) return;
      picture.hidden = true;
      notice.textContent = 'Не удалось открыть изображение.';
    };
    picture.src = url + '&preview=inline';
    picture.hidden = false;
    notice.textContent = '';
    return;
  }
  try {
    const data = await request(url + '&preview=1');
    if (token !== previewVersion || fileDialog.hidden) return;
    preview.textContent = data.text;
    preview.hidden = !data.text;
    notice.textContent = data.truncated ? 'Показана начальная часть файла.' : data.text ? '' : 'Для просмотра откройте скачанный файл.';
  } catch (error) {
    if (token === previewVersion) notice.textContent = error.message;
  }
}

/** @param {FileRow} item */
function fileButton(item) {
  const button = el('button', '', 'file-button');
  button.type = 'button';
  const suffix = item.name.includes('.') ? item.name.split('.').pop().slice(0, 5) : 'файл';
  const icon = el('span', item.folder ? '▣' : suffix, item.folder ? 'file-icon folder' : 'file-icon');
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon, el('span', item.name));
  button.setAttribute('aria-label', 'Открыть ' + (item.folder ? 'папку ' : 'файл ') + item.name);
  button.addEventListener('click', () => { void openFile(item, button); });
  return button;
}

function render() {
  results.replaceChildren();
  get('file-count').textContent = (truncated ? 'Первые ' : 'Объектов: ') + number.format(items.length);
  if (!items.length) {
    results.append(el('p', search.value.trim() ? 'По этому имени ничего не найдено.' : 'Папка пуста. Загрузите файлы или создайте подпапку.', 'empty'));
    return;
  }
  const rows = [...items].sort((a, b) => {
    if (a.folder !== b.folder) return a.folder ? -1 : 1;
    if (sort.value === 'date' && b.modified !== a.modified) return b.modified - a.modified;
    if (sort.value === 'size' && b.size !== a.size) return b.size - a.size;
    return collator.compare(a.name, b.name);
  });
  if (view === 'grid') {
    const grid = el('div', '', 'file-grid');
    for (const item of rows) {
      const card = el('article', '', 'file-card');
      card.append(fileButton(item), el('small', item.folder ? 'Папка' : sizeText(item.size)));
      if (search.value.trim()) card.append(el('small', item.path));
      grid.append(card);
    }
    results.append(grid);
    return;
  }
  const { shell, body } = table(['Имя', 'Изменён', 'Размер']);
  for (const item of rows) {
    const row = body.insertRow();
    const name = row.insertCell();
    name.append(fileButton(item));
    if (search.value.trim()) name.append(el('small', item.path, 'file-subtitle'));
    row.insertCell().append(el('time', updated.format(new Date(item.modified * 1000))));
    row.insertCell().append(el('span', item.folder ? '—' : sizeText(item.size), 'value'));
  }
  results.append(shell);
}

/** @param {string} [message] */
async function load(message = '') {
  const token = ++version;
  breadcrumbs();
  status.textContent = 'Загрузка…';
  results.replaceChildren();
  try {
    const q = new URLSearchParams({ folder, q: search.value.trim() });
    const data = await request('/api/disk?' + q);
    if (token !== version) return;
    items = data.items;
    truncated = data.truncated;
    status.textContent = message || (truncated ? 'Уточните запрос, чтобы увидеть оставшиеся совпадения.' : '');
    render();
  } catch (error) {
    if (token === version) status.textContent = error.message;
  }
}

window.addEventListener('popstate', () => {
  closePreview(false);
  folder = new URLSearchParams(location.search).get('folder') || '';
  search.value = '';
  void load();
});
search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(load, 180);
});
sort.addEventListener('change', render);
for (const pattern of ['list', 'grid']) {
  get('view-' + pattern).addEventListener('click', () => {
    view = pattern;
    get('view-grid').setAttribute('aria-pressed', String(view === 'grid'));
    get('view-list').setAttribute('aria-pressed', String(view === 'list'));
    render();
  });
}

get('refresh-files').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  try {
    const result = await post('/api/disk', { action: 'refresh' });
    await load(result.errors ? 'Часть документов недоступна для индексации.' : 'Документы обновлены.');
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
  }
});
get('new-folder').addEventListener('click', () => {
  folderForm.reset();
  get('folder-error').textContent = '';
  folderDialog.showModal();
});
folderForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = folderForm.querySelector('[type="submit"]');
  if (!(submit instanceof HTMLButtonElement) || submit.disabled) return;
  submit.disabled = true;
  try {
    const name = String(new FormData(folderForm).get('name')).trim();
    await post('/api/disk', { action: 'mkdir', folder, name });
    folderDialog.close();
    search.value = '';
    await load('Папка создана.');
  } catch (error) {
    get('folder-error').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
get('upload').addEventListener('click', () => input.click());
input.addEventListener('change', async () => {
  if (busy || !input.files.length) return;
  busy = true;
  const destination = folder;
  const uploadButton = /** @type {HTMLButtonElement} */ (get('upload'));
  uploadButton.disabled = true;
  let imported = 0;
  const errors = [];
  try {
    for (const file of input.files) {
      status.textContent = 'Загрузка ' + file.name + '…';
      try {
        const q = new URLSearchParams({ folder: destination, name: file.name });
        await request('/api/disk/upload?' + q, { method: 'POST', body: file });
        imported++;
      } catch (error) {
        errors.push(file.name + ' — ' + error.message);
      }
    }
    search.value = '';
    await load(['Загружено файлов: ' + imported + '.', ...errors].join(' '));
  } finally {
    uploadButton.disabled = false;
    input.value = '';
    busy = false;
  }
});
void load();
