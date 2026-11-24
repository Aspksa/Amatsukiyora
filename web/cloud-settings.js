// @ts-check

/** @typedef {{hasKey:boolean, model:string, models?:string[]}} Settings */
/** @typedef {{role:'user'|'assistant', content:string}} ChatMessage */

const settingsUrl = '/api/cloudru/settings';

/** @param {string} path @param {object} [body] */
async function request(path, body) {
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

/** @param {ChatMessage[]} messages @param {string} mapContext */
export async function askCloud(messages, mapContext) {
  const data = await request('/api/cloudru/chat', { messages, mapContext });
  return /** @type {string} */ (data.answer);
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
  const mode = /** @type {HTMLSelectElement} */ (document.getElementById('chat-mode'));
  const includeContext = /** @type {HTMLInputElement} */ (document.getElementById('chat-context'));
  const input = /** @type {HTMLInputElement} */ (document.getElementById('chat-input'));
  const status = document.getElementById('cloud-status');
  const options = document.getElementById('cloud-chat-options');
  const contextOption = document.getElementById('chat-context-option');
  const source = document.getElementById('chat-source');

  /** @type {Settings} */
  let saved = { hasKey: false, model: '' };
  let revision = 0;
  let busy = false;

  function renderMode() {
    options.hidden = !saved.model;
    const cloud = !!saved.model && mode.value === 'cloud';
    contextOption.hidden = !cloud;
    if (!cloud) includeContext.checked = false;
    input.maxLength = cloud ? 2000 : 200;
    input.placeholder = cloud ? 'Спросить модель…' : 'Спросить или найти…';
    source.textContent = cloud ? saved.model : 'Локальные данные';
  }

  /** @param {Settings} settings @param {boolean} [activateCloud] */
  function update(settings, activateCloud = false) {
    saved = { ...saved, ...settings };
    if (activateCloud || !saved.model) mode.value = saved.model ? 'cloud' : 'local';
    key.placeholder = saved.hasKey ? 'Ключ сохранён' : '';
    disconnect.hidden = !saved.hasKey;
    connect.textContent = saved.hasKey ? 'Обновить модели' : 'Подключить';
    model.replaceChildren(new Option('Выберите модель', ''));
    model.options[0].disabled = true;
    for (const name of saved.models || (saved.model ? [saved.model] : [])) {
      model.add(new Option(name, name));
    }
    model.value = saved.model;
    renderMode();
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
      if (apiKey || settings.model !== saved.model) revision++;
      update(settings, !!apiKey);
      key.value = '';
      status.textContent = !settings.models.length ? 'Cloud.ru не вернул доступных моделей.'
        : settings.model ? 'Cloud.ru подключён.' : 'Ключ сохранён. Выберите модель чата.';
    });
  }

  entry.addEventListener('click', () => {
    dialog.showModal();
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
      update(await request(settingsUrl, { action: 'select', model: selected }), true);
      revision++;
      status.textContent = 'Модель сохранена. Чат подключён к Cloud.ru.';
    });
  });
  disconnect.addEventListener('click', () => {
    void change(async () => {
      update(await request(settingsUrl, { action: 'disconnect' }));
      revision++;
      key.value = '';
      status.textContent = 'Cloud.ru отключён. Ключ удалён.';
    });
  });
  mode.addEventListener('change', () => {
    revision++;
    renderMode();
  });
  entry.hidden = false;
  entry.disabled = true;
  void request(settingsUrl).then(settings => update(settings, true)).catch(() => {}).finally(() => {
    entry.disabled = false;
  });

  return {
    active: () => !!saved.model && mode.value === 'cloud',
    revision: () => revision,
    includeContext: () => includeContext.checked,
  };
}
