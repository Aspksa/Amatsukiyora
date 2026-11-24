// @ts-check
/** @typedef {{id:number, group:string, label:string, excerpt?:string}} Match */
/** @typedef {{memory:number, documents:number, indexed:number, links:number, routes:{source:string,target:string,count:number}[]}} Summary */
/** @typedef {{label:string, connections:string[]}} Selection */
/** @typedef {{
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
    if (history.childElementCount > 60) history.firstElementChild.remove();
    history.scrollTop = history.scrollHeight;
    return { card, body };
  }

  /** @param {HTMLElement} parent @param {Match} match */
  function result(parent, match) {
    const item = document.createElement('div');
    const open = document.createElement('button');
    const category = document.createElement('span');
    item.className = 'chat-result';
    open.type = 'button';
    open.textContent = match.label;
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
    message(prompt, true);
    input.value = '';
    const reply = message('Ищу на карте…');
    try {
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
      const matches = await context.search(query);
      reply.body.textContent = matches.length
        ? 'Вот совпадения по запросу «' + query + '». Выберите, что открыть на карте.'
        : 'Совпадений по запросу «' + query + '» нет. Попробуйте короткую фразу или часть имени файла.';
      for (const match of matches) result(reply.card, match);
    } catch {
      reply.body.textContent = 'Поиск временно недоступен. Попробуйте ещё раз.';
    } finally {
      busy = false;
      submit.disabled = false;
      history.scrollTop = reply.card.offsetTop;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    void send(input.value);
  });
  message('Спросите, что на карте, или введите фразу для поиска по записям и документам.');
}
