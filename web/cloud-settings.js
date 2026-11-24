// @ts-check

/** @typedef {{hasKey:boolean, model:string, models?:string[]}} Settings */

const settingsUrl = '/api/cloudru/settings';

/** @param {string} path @param {object} [body] */
export async function request(path, body) {
  const response = await fetch(path, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : { cache: 'no-store' }).catch(() => {
    throw new Error('Не удалось связаться с локальным сервером.');
  });
  const data = await response.json().catch(() => {
    throw new Error('Локальный сервер вернул неожиданный ответ.');
  });
  if (!response.ok) throw new Error(response.status === 400 ? 'Проверьте введённые данные.' : data.error);
  return data;
}

export function startCloudSettings() {
  const entry = /** @type {HTMLButtonElement|null} */ (document.getElementById('cloud-settings-open'));
  if (!entry) return null;
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('cloud-settings'));
  const form = /** @type {HTMLFormElement} */ (document.getElementById('cloud-connection'));
  const key = /** @type {HTMLInputElement} */ (document.getElementById('cloud-key'));
  const model = /** @type {HTMLSelectElement} */ (document.getElementById('cloud-model'));
  const connect = /** @type {HTMLButtonElement} */ (document.getElementById('cloud-connect'));
  const disconnect = /** @type {HTMLButtonElement} */ (document.getElementById('cloud-disconnect'));
  const status = document.getElementById('cloud-status');
  const source = document.getElementById('chat-source');

  /** @type {Settings} */
  let saved = { hasKey: false, model: '' };
  let busy = false;

  /** @param {Settings} settings */
  function update(settings) {
    saved = { ...saved, ...settings };
    key.placeholder = saved.hasKey ? 'Ключ сохранён' : '';
    disconnect.hidden = !saved.hasKey;
    connect.textContent = saved.hasKey ? 'Обновить модели' : 'Подключить';
    model.replaceChildren(new Option('Выберите модель', ''));
    model.options[0].disabled = true;
    for (const name of saved.models || (saved.model ? [saved.model] : [])) {
      model.add(new Option(name, name));
    }
    model.value = saved.model;
    source.textContent = saved.model ? 'Авто · ' + saved.model : 'Локальные данные';
  }

  /** @param {() => Promise<void>} run */
  async function change(run) {
    if (busy) return;
    busy = true;
    key.disabled = connect.disabled = disconnect.disabled = model.disabled = true;
    status.textContent = 'Подключение…';
    try {
      await run();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Cloud.ru недоступен.';
      model.value = saved.model;
    } finally {
      busy = false;
      key.disabled = connect.disabled = disconnect.disabled = false;
      model.disabled = !saved.models?.length;
    }
  }

  /** @param {boolean} useInput */
  function loadModels(useInput) {
    const apiKey = useInput ? key.value.trim() : '';
    if (!apiKey && !saved.hasKey) {
      status.textContent = 'Введите API-ключ Cloud.ru.';
      key.focus();
      return;
    }
    void change(async () => {
      const settings = await request(settingsUrl, apiKey ? { action: 'models', apiKey } : { action: 'models' });
      update(settings);
      key.value = '';
      status.textContent = !settings.models.length ? 'Cloud.ru не вернул доступных моделей.'
        : settings.model ? 'Cloud.ru подключён.' : 'Ключ сохранён. Выберите модель чата.';
    });
  }

  entry.addEventListener('click', () => {
    dialog.showModal();
    renderFolders();
    if (saved.hasKey && !saved.models) loadModels(false);
  });
  document.getElementById('cloud-settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    key.value = '';
    connect.textContent = saved.hasKey ? 'Обновить модели' : 'Подключить';
  });
  key.addEventListener('input', () => {
    connect.textContent = saved.hasKey && key.value.trim() ? 'Заменить ключ' : saved.hasKey ? 'Обновить модели' : 'Подключить';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    loadModels(true);
  });
  model.addEventListener('change', () => {
    const selected = model.value;
    void change(async () => {
      update(await request(settingsUrl, { action: 'select', model: selected }));
      status.textContent = 'Модель сохранена. Чат подключён к Cloud.ru.';
    });
  });
  disconnect.addEventListener('click', () => {
    void change(async () => {
      update(await request(settingsUrl, { action: 'disconnect' }));
      key.value = '';
      status.textContent = 'Cloud.ru отключён. Ключ удалён.';
    });
  });
  const folderList = document.getElementById('cloud-folder-list');
  const folderStatus = document.getElementById('cloud-folder-status');
  const foldersUrl = '/api/map-chat/folders';

  /** @param {{folders:string[], allowed:string[]}} data */
  function fillFolders(data) {
    folderList.replaceChildren();
    for (const folder of data.folders) {
      const label = document.createElement('label');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.value = folder;
      toggle.checked = data.allowed.includes(folder);
      label.append(toggle, folder === '.' ? 'Все документы' : folder);
      folderList.append(label);
    }
    folderStatus.textContent = data.folders.length ? '' : 'Добавьте документы и перезапустите карту.';
  }

  function renderFolders() {
    folderList.replaceChildren();
    folderStatus.textContent = 'Загрузка папок…';
    void request(foldersUrl).then(fillFolders).catch(() => {
      folderStatus.textContent = 'Не удалось загрузить папки.';
    });
  }

  folderList.addEventListener('change', async () => {
    const boxes = Array.from(folderList.querySelectorAll('input'));
    boxes.forEach(box => { box.disabled = true; });
    try {
      fillFolders(await request(foldersUrl, {
        action: 'folders', folders: boxes.filter(box => box.checked).map(box => box.value),
      }));
      folderStatus.textContent = 'Разрешения сохранены.';
    } catch {
      renderFolders();
    }
  });
  entry.hidden = false;
  entry.disabled = true;
  void request(settingsUrl).then(update).catch(() => {}).finally(() => {
    entry.disabled = false;
  });
}
