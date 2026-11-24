// @ts-check
import { request } from "./cloud-settings.js";
/** @typedef {{id:number, group:string, label:string, excerpt?:string, citation?:number}} Match */
/** @typedef {{memory:number, documents:number, indexed:number, links:number, routes:{source:string,target:string,count:number}[]}} Summary */
/** @typedef {{id:number, group:string, label:string, connections:string[]}} Selection */
/** @typedef {{
 *  local?:boolean,
 *  highlight?:(matches:Match[])=>void,
 *  restore?:(view:any)=>Promise<void>,
 *  overview:()=>Summary|null,
 *  selection:()=>Selection|null,
 *  search:(query:string)=>Promise<Match[]>,
 *  inspect:(match:Match)=>Promise<boolean>,
 * }} ChatContext */

const number = new Intl.NumberFormat('ru-RU');
const count = (/** @type {number} */ value) => number.format(value);

/** @param {ChatContext} context */
export function startChat(context) {
  const history = document.getElementById('chat-history');
  const form = /** @type {HTMLFormElement} */ (document.getElementById('chat-form'));
  const input = /** @type {HTMLInputElement} */ (document.getElementById('chat-input'));
  const submit = form.querySelector('button');
  let busy = false;
  /** @type {number|null} */
  let active = null;
  const menu = /** @type {HTMLDetailsElement|null} */ (document.getElementById('chat-menu'));
  const sessionList = document.getElementById('chat-sessions');
  const newChat = /** @type {HTMLButtonElement|null} */ (document.getElementById('chat-new'));
  const path = '/api/map-chat';

  /** @param {string} text @param {boolean} [own] */
  function message(text, own = false) {
    const card = document.createElement('div');
    const speaker = document.createElement('span');
    const body = document.createElement('p');
    card.className = own ? 'chat-message chat-own' : 'chat-message';
    speaker.textContent = own ? 'Вы' : 'Карта';
    body.textContent = text;
    card.append(speaker, body);
    history.append(card);
    if (context.local && history.childElementCount > 60) history.firstElementChild.remove();
    return { card, body, speaker };
  }

  /** @param {HTMLElement} parent @param {Match} match */
  function result(parent, match) {
    const item = document.createElement('div');
    const open = document.createElement('button');
    const category = document.createElement('span');
    item.className = 'chat-result';
    open.type = 'button';
    open.textContent = (match.citation ? '[' + match.citation + '] ' : '') + match.label;
    open.setAttribute('aria-label', 'Показать на карте: ' + match.label);
    category.textContent = match.group;
    item.append(category, open);
    if (match.excerpt) {
      const excerpt = document.createElement('p');
      excerpt.textContent = match.excerpt;
      item.append(excerpt);
    }
    open.addEventListener('click', async () => {
      open.disabled = true;
      try {
        if (!await context.inspect(match)) message('Не удалось открыть результат. Запись могла быть удалена.');
      } catch {
        message('Не удалось открыть результат. Попробуйте ещё раз.');
      } finally {
        open.disabled = false;
      }
    });
    parent.append(item);
  }

  /** @param {string} prompt */
  function commonAnswer(prompt) {
    const overview = context.overview();
    if (/^связи (?:узла|записи)|^что связано с (?:узлом|записью)/iu.test(prompt)) {
      const current = context.selection();
      if (!current) return 'Выберите узел на карте и спросите «Связи узла».';
      return current.label + '\n' + (current.connections.join('\n') || 'У этой записи нет отображаемых связей.');
    }
    if (/^(?:где больше всего связей|сколько связей|связи)[?.!]*$/iu.test(prompt)) {
      if (!overview) return 'Карта ещё загружается.';
      const top = overview.routes.reduce((a, b) => !a || b.count > a.count ? b : a, null);
      const route = top && (top.source === top.target ? 'внутри категории «' + top.source + '»' : top.source + ' ↔ ' + top.target);
      return 'Связей на карте: ' + count(overview.links) + '.' + (top ? '\nБольше всего ' + route + ' — ' + count(top.count) + '.' : '');
    }
    if (/^(?:сколько (?:всего )?документов|документы)[?.!]*$/iu.test(prompt)) {
      if (!overview) return 'Карта ещё загружается.';
      return 'Документов: ' + count(overview.documents) + '. Поиск по тексту доступен для ' + count(overview.indexed) + ' из них.';
    }
    if (/^(?:что на карте|обзор|статистика|сколько записей)[?.!]*$/iu.test(prompt)) {
      if (!overview) return 'Карта ещё загружается.';
      return 'Записи: ' + count(overview.memory) + '\nДокументы: ' + count(overview.documents) + '\nСвязи: ' + count(overview.links);
    }
    return null;
  }

  /** @param {string} prompt */
  async function send(prompt) {
    prompt = prompt.trim();
    if (!prompt || busy) return;
    busy = true;
    submit.disabled = true;
    if (newChat) newChat.disabled = true;
    history.querySelector('.chat-welcome')?.remove();
    message(prompt, true);
    input.value = '';
    const reply = message('Ищу на карте…');
    history.scrollTop = history.scrollHeight;
    try {
      if (!context.local) {
        const selection = context.selection();
        const data = await request(path, {
          action: 'send', session: active, prompt,
          selection: selection && { id: selection.id, group: selection.group },
        });
        const turn = data.turns[0];
        showReply(reply, turn);
        updateChat(data, turn.sources);
        return;
      }
      const summary = commonAnswer(prompt);
      if (summary) {
        reply.body.textContent = summary;
        return;
      }
      const query = prompt
        .replace(/^(?:найди(?:те)?|покажи(?:те)?|поиск:)\s*/iu, '')
        .replace(/^(?:документы?|записи)\s+(?:про|по теме)\s+/iu, '')
        .replace(/^[«"“]|[»"”?.!]+$/gu, '').trim();
      if (!query) {
        reply.body.textContent = 'Укажите имя файла, название записи или фразу из документа.';
        return;
      }
      if (Array.from(query).length > 200) {
        reply.body.textContent = 'Для локального поиска сократите фразу до 200 символов.';
        return;
      }
      const matches = await context.search(query);
      reply.body.textContent = matches.length
        ? 'Вот совпадения по запросу «' + query + '». Выберите, что открыть на карте.'
        : 'Совпадений по запросу «' + query + '» нет. Попробуйте короткую фразу или часть имени файла.';
      for (const match of matches) result(reply.card, match);
    } catch (error) {
      reply.body.textContent = error instanceof Error && !context.local
        ? error.message : 'Поиск временно недоступен. Попробуйте ещё раз.';
    } finally {
      busy = false;
      submit.disabled = false;
      if (newChat) newChat.disabled = false;
      history.scrollTop = history.scrollHeight;
    }
  }

  /** @typedef {{prompt:string, reply:string|null, mode:string|null, sources:Match[]}} Turn */
  /** @typedef {{active:number|null, view?:any, sessions?:{id:number,title:string}[], turns:Turn[]}} Conversation */

  /** @param {ReturnType<typeof message>} card @param {Turn} turn */
  function showReply(card, turn) {
    card.body.textContent = turn.reply || 'Запрос прервался. Вопрос сохранён.';
    if (turn.mode === 'cloud' || turn.mode === 'grounded') card.speaker.textContent = 'Cloud.ru';
    for (const match of turn.sources) result(card.card, match);
  }

  /** @param {Conversation} data @param {Match[]} matches */
  function updateChat(data, matches) {
    active = data.active;
    context.highlight?.(matches);
    if (data.sessions && sessionList) {
      sessionList.replaceChildren();
      for (const session of data.sessions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = session.title;
        if (session.id === active) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => changeChat({ action: 'open', session: session.id }));
        sessionList.append(button);
      }
    }
    history.scrollTop = history.scrollHeight;
  }

  /** @param {Conversation} data */
  function render(data) {
    history.replaceChildren();
    if (!data.turns.length) {
      message('Спросите о карте, найдите материал или выберите узел.').card.classList.add('chat-welcome');
    }
    for (const turn of data.turns) {
      message(turn.prompt, true);
      showReply(message(''), turn);
    }
    updateChat(data, data.turns[data.turns.length - 1]?.sources || []);
  }

  /** @param {object} action */
  async function changeChat(action) {
    if (busy) return;
    busy = submit.disabled = true;
    if (newChat) newChat.disabled = true;
    if (menu) menu.open = false;
    try {
      render(await request(path, action));
      input.value = '';
      input.focus();
    } catch {
      message('Не удалось открыть беседу.');
    } finally {
      busy = submit.disabled = false;
      if (newChat) newChat.disabled = false;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    void send(input.value);
  });
  if (context.local) {
    message('Спросите, что на карте, или введите фразу для поиска по записям и документам.');
    return;
  }
  if (menu) menu.hidden = false;
  newChat?.addEventListener('click', () => changeChat({ action: 'new' }));
  busy = submit.disabled = true;
  if (newChat) newChat.disabled = true;
  void request(path).then(async data => {
    await context.restore?.(data.view);
    render(data);
  }).catch(() => message('Не удалось загрузить историю.')).finally(() => {
    busy = submit.disabled = false;
    if (newChat) newChat.disabled = false;
  });
}
