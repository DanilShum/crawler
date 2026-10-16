# Подсистема B: thin-content, дубли контента, ключевые слова — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** добавить в краулер проверки thin-content (по wordCount с настраиваемым порогом) и дублей контента (simhash), а также частотный топ слов страницы в деталях.

**Architecture:** токены текста собираются в экстракторе (тот же поток, что у wordCount); из них считаются `topWords` (в `PageResult`) и 64-битный simhash (во внутреннем `Map` движка, не в `PageResult`). Проверки выполняются в `computeIssues` через новый параметр `extras`; `pagesInIssueGroup` в routes повторяет правила через общий helper `findDuplicateGroups`.

**Tech Stack:** TypeScript, vitest, cheerio, Vue 3 (TSX) + Pinia, Fastify. Без новых зависимостей (simhash — своя реализация на BigInt).

**Spec:** docs/superpowers/specs/2026-10-16-thin-content-duplicates-design.md

## Global Constraints

- Дефолт порога thin-content: **100 слов**, диапазон **0–10000**, целое (`parseCrawlOptions`).
- Порог дублей simhash: расстояние Хэмминга **≤ 3** (константа).
- В дубль-группу попадают все участники, **кроме эталона** (эталон = минимальный url).
- `topWords` — максимум **20** записей, сортировка count убыв., при равенстве — алфавит.
- Проверки thin-content/duplicate-content не ломают старые вызовы `computeIssues` (extras опционален, дубли без `textHashes` не считаются).
- Свежие комментарии в коде — по-русски, стиль существующих файлов.
- Тесты: `npm test -w @seo-crawler/server -- <путь>` и `npm test -w @seo-crawler/web -- <путь>`; перед коммитом весь воркспейс: `npm test -w @seo-crawler/server`.

## Review Focus

- Токен с пунктуацией/эмодзи («данных,», «—») → не должен породить пустое слово или мусор в topWords: ожидание — только слова из букв/цифр (тест в Task 1).
- `wordCount` ровно на пороге (100 при пороге 100) → страница **не** thin-content: сравнение строгое `<` (тест в Task 6).
- Слово в разных регистрах («Слово»/«слово») → одно слово в topWords (lowercase, тест в Task 1).
- Дубль-группа из 3+ страниц → в отчёт попадают все, кроме эталона — минимального url (тест в Task 6).
- `computeIssues` без `extras` (старые вызовы) → thin-content по дефолту 100, duplicate-content не возникает, исключений нет (тест в Task 6).

---

### Task 1: Токены текста и topWords в экстракторе

**Files:**
- Modify: `apps/server/src/crawler/extract.ts`
- Test: `apps/server/src/crawler/extract.test.ts`

**Interfaces:**
- Consumes: существующая `extractPageData(html: string): ExtractedHtml` (wordCount уже считается там по текстовым нодам).
- Produces: `ExtractedHtml += words: string[]` (все видимые слова body, lowercase, в порядке документа) и `topWords: TopWord[]`, где `interface TopWord { word: string; count: number }`. Слово — последовательность букв/цифр (`\p{L}`, `\p{N}`); слова < 2 символов, чисто числовые и стоп-слова отбрасываются.

- [ ] **Step 1: Write the failing test**

Добавить в `apps/server/src/crawler/extract.test.ts` (существующие фикстуры страниц в файле — посмотреть их стиль и добавить HTML-фикстуру с телом):

```ts
describe('words и topWords', () => {
  it('собирает токены видимого текста (lowercase), исключая script/style', () => {
    const html = `<!doctype html><html><body>
      <h1>Каталог товаров</h1>
      <p>Каталог товаров: книги, журналы и каталог наборов.</p>
      <script>var ignored = "каталог";</script>
      <style>.ignored { color: каталог; }</style>
    </body></html>`;
    const data = extractPageData(html);
    expect(data.words).toEqual([
      'каталог', 'товаров', 'каталог', 'товаров', 'книги', 'журналы',
      'и', 'каталог', 'наборов',
    ]);
  });

  it('topWords: пунктуация срезается, короткие/числовые/стоп-слова отброшены, топ-20 с сортировкой', () => {
    const html = `<!doctype html><html><body>
      <p>Каталог, каталог каталог! товаров — товаров товаров 42 а и the</p>
    </body></html>`;
    const data = extractPageData(html);
    expect(data.topWords).toEqual([
      { word: 'каталог', count: 3 },
      { word: 'товаров', count: 3 },
    ]);
  });

  it('topWords ограничен 20 записями', () => {
    const body = Array.from({ length: 25 }, (_, i) => `слово${i}`).join(' ');
    const data = extractPageData(`<!doctype html><html><body><p>${body}</p></body></html>`);
    expect(data.topWords.length).toBe(20);
  });
});
```

(Если в файле фикстуры-константы — встроить HTML прямо в тест, как выше; `extractPageData` импортирован уже.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/server -- src/crawler/extract.test.ts`
Expected: FAIL — `data.words`/`data.topWords` отсутствуют в `ExtractedHtml`.

- [ ] **Step 3: Write minimal implementation**

В `apps/server/src/crawler/extract.ts`:

В `ExtractedHtml` добавить:

```ts
  words: string[];
  topWords: TopWord[];
```

Над `extractPageData` добавить:

```ts
export interface TopWord { word: string; count: number; }

// Стоп-слова ru+en: предлоги/союзы/местоимения и т.п. — в топ ключевых слов не попадают.
const STOP_WORDS = new Set([
  // ru
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все',
  'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по',
  'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из',
  'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или',
  'ни', 'быть', 'был', 'него', 'до', 'вас', 'опять', 'уж', 'вам', 'ведь', 'там',
  'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо',
  'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто',
  'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'тогда', 'кто', 'этот', 'того',
  'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом', 'один', 'почти',
  'мой', 'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем', 'всех',
  'никогда', 'сегодня', 'можно', 'при', 'наконец', 'два', 'об', 'другой', 'хоть',
  'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них',
  'какая', 'много', 'три', 'эту', 'моя', 'впрочем', 'свою', 'этой', 'перед',
  'иногда', 'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда',
  'конечно', 'всю', 'между', 'это', 'который', 'которые', 'которых',
  // en
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'we', 'they', 'them', 'his', 'her', 'their',
  'our', 'your', 'my', 'me', 'him', 'us', 'do', 'does', 'did', 'have', 'has',
  'had', 'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might',
  'must', 'not', 'no', 'nor', 'so', 'than', 'too', 'very', 'just', 'about',
  'into', 'over', 'under', 'out', 'up', 'down', 'off', 'again', 'here',
  'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'only', 'own', 'same',
]);

const TOP_WORDS_LIMIT = 20;

export function topWords(words: string[]): TopWord[] {
  const counts = new Map<string, number>();
  for (const raw of words) {
    // пунктуация вокруг/внутри слова → разделитель: «каталог,» и «каталог-каталог»
    for (const w of raw.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')) {
      if (w.length < 2 || /^\d+$/.test(w) || STOP_WORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, TOP_WORDS_LIMIT);
}
```

Заменить блок подсчёта wordCount (сейчас собирает только число) на сбор токенов:

```ts
  // wordCount/words: считаем по текстовым нодам (у каждой один родитель — двойного учёта нет);
  // .text() склеивает соседние блочные элементы без разделителей («H1один») — так нельзя
  const bodyClone = $('body').clone();
  bodyClone.find('script, style, noscript, svg').remove();
  const words: string[] = [];
  bodyClone.find('*').addBack().contents().each((_, node) => {
    if (node.type === 'text') {
      for (const w of ((node as { data?: string }).data ?? '').split(/\s+/)) {
        if (w) words.push(w.toLowerCase());
      }
    }
  });
  const wordCount = words.length;
```

В возвращаемый объект добавить `words, topWords: topWords(words)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/server -- src/crawler/extract.test.ts`
Expected: PASS (все тесты файла, включая старые — wordCount не изменился).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/extract.ts apps/server/src/crawler/extract.test.ts
git commit -m "feat: токены видимого текста и topWords в экстракторе"
```

---

### Task 2: Shared-типы (thinContentThreshold, topWords, новые IssueKind) + проводка в движке

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/crawler/engine.ts:203-220` (блок `if (parsed)`), `apps/server/src/crawler/engine.ts:254-286` (`baseResult`)
- Test: `apps/server/src/crawler/engine.test.ts`

**Interfaces:**
- Consumes: `ExtractedHtml.topWords` из Task 1.
- Produces: в `CrawlOptions` поле `thinContentThreshold: number` (обязательное); в `PageResult` поле `topWords: TopWord[]`; `IssueKind += 'thin-content' | 'duplicate-content'`. Из `@seo-crawler/shared` экспортируется `TopWord`.

- [ ] **Step 1: Write the failing test**

В `apps/server/src/crawler/engine.test.ts` добавить тест внутрь `describe('Crawler spider')` (helper'ы `opts`/`run` уже есть в файле):

```ts
  it('заполняет topWords из экстракции для HTML-страниц', async () => {
    const site = await startTestSite();
    try {
      const { pages } = await run(site.origin, opts(site.origin));
      const home = pages.find((p) => p.url === site.origin + '/')!;
      expect(home.topWords.length).toBeGreaterThan(0);
      // каждый элемент — { word, count }
      for (const w of home.topWords) {
        expect(typeof w.word).toBe('string');
        expect(typeof w.count).toBe('number');
      }
    } finally { await site.close(); }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/server -- src/crawler/engine.test.ts`
Expected: FAIL — TypeScript-ошибка (`topWords` нет в `PageResult`) или `undefined`.

- [ ] **Step 3: Write minimal implementation**

В `packages/shared/src/types.ts`:

```ts
export interface TopWord { word: string; count: number; }

export interface CrawlOptions {
  // ... существующие поля ...
  thinContentThreshold: number;     // порог thin-content, слов
}
```

В `PageResult` (после `wordCount`):

```ts
  topWords: TopWord[];              // топ-20 ключевых слов видимого текста
```

В `IssueKind` добавить варианты:

```ts
  | 'thin-content' | 'duplicate-content'
```

Проверить `packages/shared/src/types.test.ts`: если там есть проверка структуры `PageResult` — дополнить.

В `apps/server/src/crawler/engine.ts`:

`baseResult` (перед закрывающей скобкой объекта, рядом с `wordCount: 0`):

```ts
      topWords: [],
```

В блоке `if (parsed)` (рядом с `result.wordCount = parsed.wordCount;`):

```ts
      result.topWords = parsed.topWords;
```

Собрать типы: `npx tsc --noEmit -p apps/server` (или общий tsconfig проекта — см. как проверяют в CI/скриптах). Исправить все места, где конструируется `CrawlOptions` без `thinContentThreshold`: `engine.test.ts` (helper `opts`), `routes.test.ts` (константа `BASE`), `session-manager.test.ts` — добавить `thinContentThreshold: 100`.

Убрать локальный интерфейс `TopWord` из `extract.ts` (Task 1) и импортировать из shared, чтобы не дублировать тип:

```ts
import type { TopWord } from '@seo-crawler/shared';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/server -- src/crawler/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/types.test.ts apps/server/src/crawler/engine.ts apps/server/src/crawler/engine.test.ts
git commit -m "feat: типы thinContentThreshold/topWords и новые IssueKind + проводка в движке"
```

---

### Task 3: Поле порога в CrawlForm + i18n

**Files:**
- Modify: `apps/web/src/components/CrawlForm.tsx:10-15` (NUMBER_LIMITS), `apps/web/src/components/CrawlForm.tsx:94-107` (buildOptions)
- Modify: `apps/web/src/locales/ru.json`, `apps/web/src/locales/en.json`
- Test: `apps/web/src/components/CrawlForm.test.tsx`

**Interfaces:**
- Consumes: `CrawlOptions.thinContentThreshold` из Task 2.
- Produces: форма отправляет `thinContentThreshold` (число, 0–10000, дефолт 100).

- [ ] **Step 1: Write the failing test**

В `apps/web/src/components/CrawlForm.test.tsx` (посмотреть существующие тесты и их паттерн выбора полей — mount + `find('[name=...]')`) добавить:

```tsx
it('отправляет thinContentThreshold с дефолтом 100', async () => {
  // существующий паттерн: mount формы, заполнить startUrl, submit
  const wrapper = mountForm({ startUrl: 'https://example.com' });
  await wrapper.find('form').trigger('submit');
  const sent = submittedOptions(wrapper);
  expect(sent.thinContentThreshold).toBe(100);
});

it('валидирует thinContentThreshold вне диапазона 0-10000', async () => {
  const wrapper = mountForm({ startUrl: 'https://example.com' });
  await wrapper.find('input[name=thinContentThreshold]').setValue('20000');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.find('[data-test=error]').text()).toContain('0');
});
```

(Адаптировать к фактическим helper'ам файла: если там нет `mountForm`/`submittedOptions`, повторить паттерн соседнего теста с NUMBER_LIMITS-полем, например `maxUrls`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/web -- src/components/CrawlForm.test.tsx`
Expected: FAIL — поля нет, `thinContentThreshold` не отправляется.

- [ ] **Step 3: Write minimal implementation**

`CrawlForm.tsx` — в `NUMBER_LIMITS` добавить:

```ts
  thinContentThreshold: { min: 0, max: 10000, def: '100' },
```

(Поле отрисуется автоматически: форма рендерит `Object.keys(NUMBER_LIMITS)` в `field-grid`.)

В `buildOptions()` добавить строку:

```ts
        thinContentThreshold: Number(nums.thinContentThreshold.value.trim()),
```

`ru.json` → `form`:

```json
    "thinContentThreshold": "Порог thin-content (слов)",
```

`en.json` → `form`:

```json
    "thinContentThreshold": "Thin-content threshold (words)",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/web -- src/components/CrawlForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/CrawlForm.tsx apps/web/src/components/CrawlForm.test.tsx apps/web/src/locales/ru.json apps/web/src/locales/en.json
git commit -m "feat: поле порога thin-content в форме сканирования"
```

---

### Task 4: simhash — simhashHex, hammingHex, findDuplicateGroups

**Files:**
- Create: `apps/server/src/crawler/simhash.ts`
- Test: `apps/server/src/crawler/simhash.test.ts`

**Interfaces:**
- Consumes: ничего (чистая функция над `string[]`).
- Produces (используют Task 5, 6, 8):
  - `simhashHex(words: string[]): string` — 16-символьный hex 64-битного хэша;
  - `hammingHex(a: string, b: string): number`;
  - `findDuplicateGroups(textHashes: Map<string, string>): string[][]` — группы url с расстоянием ≤ 3 между любыми участниками группы, url внутри группы отсортированы (`localeCompare`), первый — эталон;
  - `MAX_SIMHASH_DISTANCE = 3` (экспорт для тестов).

- [ ] **Step 1: Write the failing test**

Создать `apps/server/src/crawler/simhash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { simhashHex, hammingHex, findDuplicateGroups, MAX_SIMHASH_DISTANCE } from './simhash';

function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

describe('simhashHex', () => {
  it('идентичные тексты → расстояние 0', () => {
    const a = simhashHex(words('купить чайник недорого в москве с доставкой сегодня'));
    const b = simhashHex(words('купить чайник недорого в москве с доставкой сегодня'));
    expect(hammingHex(a, b)).toBe(0);
  });

  it('малая правка (пара слов) → расстояние <= 3', () => {
    const a = simhashHex(words('купить чайник недорого в москве с доставкой сегодня вечером'));
    const b = simhashHex(words('купить чайник недорого в москве с доставкой сегодня утром'));
    expect(hammingHex(a, b)).toBeLessThanOrEqual(MAX_SIMHASH_DISTANCE);
  });

  it('разные тексты → расстояние > 3', () => {
    const a = simhashHex(words('купить чайник недорого в москве с доставкой сегодня'));
    const b = simhashHex(words('аренда яхты на средиземном море с капитаном и командой'));
    expect(hammingHex(a, b)).toBeGreaterThan(MAX_SIMHASH_DISTANCE);
  });

  it('детерминированность и формат (16 hex-символов)', () => {
    const h = simhashHex(words('текст для хэширования'));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toBe(simhashHex(words('текст для хэширования')));
  });

  it('пустой список слов → валидный хэш', () => {
    expect(simhashHex([])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('findDuplicateGroups', () => {
  it('объединяет одинаковые и близкие хэши, url отсортированы', () => {
    const h1 = simhashHex(words('одинаковый текст страницы номер один'));
    const h2 = simhashHex(words('одинаковый текст страницы номер один'));
    const far = simhashHex(words('совершенно другой контент про яхты и море'));
    const groups = findDuplicateGroups(new Map([
      ['https://b.test/', h2],
      ['https://a.test/', h1],
      ['https://c.test/', far],
    ]));
    expect(groups).toEqual([['https://a.test/', 'https://b.test/']]);
  });

  it('уникальные страницы не попадают в группы', () => {
    const groups = findDuplicateGroups(new Map([
      ['https://a.test/', simhashHex(words('текст а'))],
      ['https://b.test/', simhashHex(words('текст б'))],
    ]));
    expect(groups).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/server -- src/crawler/simhash.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Write minimal implementation**

Создать `apps/server/src/crawler/simhash.ts`:

```ts
// 64-битный simhash без зависимостей: шинглы из 3 слов, FNV-1a 64, векторные веса.
// Числа — BigInt: 64-битные операции на number в JS теряют точность.

export const MAX_SIMHASH_DISTANCE = 3;
const MASK_64 = 0xffffffffffffffffn;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a64(text: string): bigint {
  const bytes = new TextEncoder().encode(text);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/** 64-битный simhash списка слов → 16 hex-символов. */
export function simhashHex(words: string[]): string {
  // шинглы из 3 слов подряд; при < 3 слов — один шингл из всех
  const shingles: string[] = words.length >= 3
    ? words.slice(0, words.length - 2).map((_, i) => words.slice(i, i + 3).join(' '))
    : [words.join(' ')];

  const weights = new Array<number>(64).fill(0);
  for (const shingle of shingles) {
    const h = fnv1a64(shingle);
    for (let bit = 0; bit < 64; bit++) {
      weights[bit] += (h >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }

  let hash = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit] > 0) hash |= 1n << BigInt(bit);
  }
  return hash.toString(16).padStart(16, '0');
}

/** Расстояние Хэмминга между hex-хэшами. */
export function hammingHex(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * Кластеризация url по близости хэшей: url добавляется в существующую группу,
 * если его хэш близок (<= MAX_SIMHASH_DISTANCE) хотя бы к одному участнику,
 * иначе — новая группа. Группы меньше 2 url отбрасываются.
 * Порядок входа детерминирован (сортировка по url), поэтому первый элемент
 * группы — «эталон» (минимальный url).
 */
export function findDuplicateGroups(textHashes: Map<string, string>): string[][] {
  const sorted = [...textHashes.entries()].sort(([a], [b]) => a.localeCompare(b));
  const groups: { hashes: string[]; urls: string[] }[] = [];
  for (const [url, hash] of sorted) {
    const g = groups.find((grp) => grp.hashes.some((h) => hammingHex(h, hash) <= MAX_SIMHASH_DISTANCE));
    if (g) {
      g.hashes.push(hash);
      g.urls.push(url);
    } else {
      groups.push({ hashes: [hash], urls: [url] });
    }
  }
  return groups.filter((g) => g.urls.length > 1).map((g) => g.urls);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/server -- src/crawler/simhash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/simhash.ts apps/server/src/crawler/simhash.test.ts
git commit -m "feat: simhash (FNV-1a 64 по шинглам), hamming, кластеризация дублей"
```

---

### Task 5: textHashes в движке

**Files:**
- Modify: `apps/server/src/crawler/engine.ts:23-24` (поля класса), `apps/server/src/crawler/engine.ts:214-220` (блок `if (parsed)`)
- Test: `apps/server/src/crawler/engine.test.ts`

**Interfaces:**
- Consumes: `simhashHex` из Task 4, `ExtractedHtml.words` из Task 1.
- Produces: `Crawler.textHashes: Map<string, string>` (readonly-поле, url → hex) — используют Task 7 и 8. Хэш ставится только для распарсенных HTML-страниц; не-HTML и ошибочные URL в карте отсутствуют.

- [ ] **Step 1: Write the failing test**

В `apps/server/src/crawler/engine.test.ts` (тестовый сайт имеет HTML-страницы и `/binary.pdf`, `/missing` — см. существующие тесты):

```ts
  it('textHashes наполняется для HTML и пуст для не-HTML/ошибочных', async () => {
    const site = await startTestSite();
    try {
      const { crawler } = await run(site.origin, opts(site.origin));
      expect(crawler.textHashes.get(site.origin + '/')).toMatch(/^[0-9a-f]{16}$/);
      expect(crawler.textHashes.has(site.origin + '/binary.pdf')).toBe(false);
      expect(crawler.textHashes.has(site.origin + '/missing')).toBe(false);
    } finally { await site.close(); }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/server -- src/crawler/engine.test.ts`
Expected: FAIL — `crawler.textHashes` отсутствует.

- [ ] **Step 3: Write minimal implementation**

В `apps/server/src/crawler/engine.ts`:

Рядом с `readonly linkStatuses`:

```ts
  // Текстовые хэши страниц для поиска дублей (не попадают в PageResult — см. спеку B)
  readonly textHashes = new Map<string, string>();
```

В блоке `if (parsed)`, после `result.topWords = parsed.topWords;`:

```ts
      this.textHashes.set(item.url, simhashHex(parsed.words));
```

Импорт: `import { simhashHex } from './simhash';`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/server -- src/crawler/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/engine.ts apps/server/src/crawler/engine.test.ts
git commit -m "feat: текстовые simhash-хэши страниц в движке (textHashes)"
```

---

### Task 6: Проверки thin-content и duplicate-content в computeIssues

**Files:**
- Modify: `apps/server/src/crawler/issues.ts`
- Test: `apps/server/src/crawler/issues.test.ts`

**Interfaces:**
- Consumes: `findDuplicateGroups` из Task 4; `wordCount`/`topWords` в `PageResult` из Task 2.
- Produces: `computeIssues(results, linkStatuses, extras?)`, где `interface IssueExtras { textHashes?: Map<string, string>; thinContentThreshold?: number }` (экспорт). Дефолт порога — 100. Правила: thin — `isHtml(r) && r.wordCount < threshold`; duplicate — все участники групп `findDuplicateGroups`, кроме эталона (первого, минимального url).

- [ ] **Step 1: Write the failing test**

В `apps/server/src/crawler/issues.test.ts` (helper `page()` существует):

```ts
describe('thin-content и duplicate-content', () => {
  const linkStatuses = new Map<string, number | null>();

  it('thin-content: wordCount ниже порога на HTML-странице', () => {
    const results = [page({ url: `${BASE}/thin`, wordCount: 20 })];
    const issues = computeIssues(results, linkStatuses, { thinContentThreshold: 100 });
    expect(issues.find((i) => i.kind === 'thin-content')).toMatchObject({ count: 1 });
  });

  it('thin-content: wordCount ровно на пороге не попадает; не-HTML не проверяется', () => {
    const results = [
      page({ url: `${BASE}/edge`, wordCount: 100 }),
      page({ url: `${BASE}/pdf`, wordCount: 0, contentType: 'application/pdf' }),
    ];
    const issues = computeIssues(results, linkStatuses, { thinContentThreshold: 100 });
    expect(issues.find((i) => i.kind === 'thin-content')).toBeUndefined();
  });

  it('без extras порог по умолчанию 100', () => {
    const issues = computeIssues([page({ url: `${BASE}/thin`, wordCount: 99 })], linkStatuses);
    expect(issues.find((i) => i.kind === 'thin-content')).toMatchObject({ count: 1 });
  });

  it('duplicate-content: группа из двух страниц — в отчёте одна (эталон не попал)', () => {
    const same = 'https://site.test/';
    const hashes = new Map([
      [`${BASE}/a`, simhashHex(['dup', 'text', 'here', 'now'])],
      [`${BASE}/b`, simhashHex(['dup', 'text', 'here', 'now'])],
    ]);
    const issues = computeIssues(
      [page({ url: `${BASE}/a` }), page({ url: `${BASE}/b` })],
      linkStatuses,
      { textHashes: hashes },
    );
    const issue = issues.find((i) => i.kind === 'duplicate-content')!;
    expect(issue.count).toBe(1);
    expect(issue.sampleUrls).toEqual([`${BASE}/b`]);
  });

  it('duplicate-content: группа из трёх — все, кроме эталона', () => {
    const h = simhashHex(['dup', 'text', 'here', 'now']);
    const hashes = new Map([
      [`${BASE}/a`, h], [`${BASE}/b`, h], [`${BASE}/c`, h],
    ]);
    const issues = computeIssues(
      [page({ url: `${BASE}/a` }), page({ url: `${BASE}/b` }), page({ url: `${BASE}/c` })],
      linkStatuses,
      { textHashes: hashes },
    );
    expect(issues.find((i) => i.kind === 'duplicate-content')).toMatchObject({ count: 2 });
  });

  it('duplicate-content: без textHashes проверка не выполняется', () => {
    const issues = computeIssues([page({ url: `${BASE}/a` })], linkStatuses);
    expect(issues.find((i) => i.kind === 'duplicate-content')).toBeUndefined();
  });
});
```

Добавить импорт: `import { simhashHex } from './simhash';`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/server -- src/crawler/issues.test.ts`
Expected: FAIL — `computeIssues` принимает 2 аргумента, TypeScript-ошибка.

- [ ] **Step 3: Write minimal implementation**

В `apps/server/src/crawler/issues.ts`:

```ts
import { findDuplicateGroups } from './simhash';

export interface IssueExtras {
  textHashes?: Map<string, string>;
  thinContentThreshold?: number;
}

const DEFAULT_THIN_THRESHOLD = 100;
```

Сигнатура и добавления в конец основного цикла + после него:

```ts
export function computeIssues(
  results: PageResult[],
  linkStatuses: Map<string, number | null>,
  extras?: IssueExtras,
): Issue[] {
```

В цикле по результатам (рядом с `if (r.noindex)`):

```ts
    if (isHtml(r) && r.wordCount < (extras?.thinContentThreshold ?? DEFAULT_THIN_THRESHOLD)) {
      add('thin-content', r.url);
    }
```

После цикла (перед `return`):

```ts
  // duplicate-content: участники дубль-групп, кроме эталона (первый = минимальный url)
  if (extras?.textHashes) {
    for (const group of findDuplicateGroups(extras.textHashes)) {
      for (const url of group.slice(1)) add('duplicate-content', url);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/server -- src/crawler/issues.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/issues.ts apps/server/src/crawler/issues.test.ts
git commit -m "feat: проверки thin-content и duplicate-content в отчёте issues"
```

---

### Task 7: Проводка extras в session-manager

**Files:**
- Modify: `apps/server/src/session/session-manager.ts:22-31` (интерфейс), `apps/server/src/session/session-manager.ts:83-85` (recomputeIssues)
- Test: `apps/server/src/session/session-manager.test.ts`

**Interfaces:**
- Consumes: `computeIssues(results, linkStatuses, extras)` из Task 6; `Crawler.textHashes` из Task 5; `CrawlOptions.thinContentThreshold` из Task 2.
- Produces: `CrawlSession += get textHashes(): Map<string, string>` (делегирует движку) — используют Task 8 (routes).

- [ ] **Step 1: Write the failing test**

В `apps/server/src/session/session-manager.test.ts` (посмотреть существующий паттерн запуска краула с тестовым сайтом и `waitDone`-аналогом) добавить:

```ts
  it('issues учитывают thinContentThreshold опций и textHashes движка', async () => {
    const site = await startTestSite();
    try {
      // порог выше, чем слов на странице → все HTML-страницы thin
      const { id, session } = await startAndWait(site.origin, { thinContentThreshold: 100000 });
      const thin = session.issues().find((i) => i.kind === 'thin-content');
      expect(thin).toBeDefined();
      expect(thin!.count).toBeGreaterThan(0);
      expect(session.textHashes.size).toBeGreaterThan(0);
    } finally { await site.close(); }
  });
```

(Имена helper'ов адаптировать к файлу: если краул запускается иначе — повторить паттерн соседнего теста; `thinContentThreshold` обязателен в `CrawlOptions` с Task 2, значит существующие фикстуры опций в этом файле уже дополнены.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/server -- src/session/session-manager.test.ts`
Expected: FAIL — `session.textHashes` отсутствует / thin не определяется (extras не передаются).

- [ ] **Step 3: Write minimal implementation**

В `apps/server/src/session/session-manager.ts`:

Интерфейс `CrawlSession` (после `linkStatuses`):

```ts
  get textHashes(): Map<string, string>;
```

Реализация в объекте `session` (рядом с `linkStatuses`):

```ts
      get textHashes(): Map<string, string> { return crawler.textHashes; },
```

`recomputeIssues`:

```ts
    const recomputeIssues = (): void => {
      currentIssues = computeIssues([...results.values()], crawler.linkStatuses, {
        textHashes: crawler.textHashes,
        thinContentThreshold: options.thinContentThreshold,
      });
      issuesDirty = false;
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/server -- src/session/session-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/session/session-manager.ts apps/server/src/session/session-manager.test.ts
git commit -m "feat: session-manager передаёт в issues textHashes и порог thin-content"
```

---

### Task 8: routes — валидация порога, ISSUE_KINDS, pagesInIssueGroup (+ попутный фикс проверок подсистемы A)

**Files:**
- Modify: `apps/server/src/api/routes.ts:10-13` (ISSUE_KINDS), `apps/server/src/api/routes.ts:31-88` (parseCrawlOptions), `apps/server/src/api/routes.ts:90-151` (pagesInIssueGroup), `apps/server/src/api/routes.ts:219-221` (вызов)
- Test: `apps/server/src/api/routes.test.ts`

**Interfaces:**
- Consumes: `CrawlSession.textHashes` (Task 7), `findDuplicateGroups` (Task 4), `isHeadingOrderBroken` — экспортировать из `issues.ts` (Task 6 файл, однострочное изменение: `export function isHeadingOrderBroken`).
- Produces: `parseCrawlOptions` принимает `thinContentThreshold` (0–10000, дефолт 100 при отсутствии); фильтр `?issue=` работает для `thin-content`, `duplicate-content` и четырёх проверок подсистемы A (`missing-og`, `missing-favicon`, `missing-lang`, `heading-order`), которые сейчас НЕ добавлены в `ISSUE_KINDS`/`pagesInIssueGroup` — это баг, найденный при планировании: фильтр по ним отвечает 400, а `pagesInIssueGroup` не имеет их кейсов.

- [ ] **Step 1: Write the failing test**

В `apps/server/src/api/routes.test.ts` (BASE уже есть; после краула тестового сайта):

```ts
  it('POST /api/crawl: thinContentThreshold по умолчанию 100, вне диапазона → 400', async () => {
    const { app, sessions } = newApp();
    const site = await startTestSite();
    try {
      const ok = await app.inject({
        method: 'POST', url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE },
        headers: { 'content-type': 'application/json' },
      });
      expect(sessions.get(ok.json().id)!.options.thinContentThreshold).toBe(100);

      const bad = await app.inject({
        method: 'POST', url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE, thinContentThreshold: 20000 },
        headers: { 'content-type': 'application/json' },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ error: 'VALIDATION' });
    } finally { await site.close(); }
  });

  it('GET /pages?issue=thin-content и ?issue=missing-og фильтруются без 400', async () => {
    const site = await startTestSite();
    try {
      const { app, sessions } = newApp();
      const started = await app.inject({
        method: 'POST', url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE, thinContentThreshold: 1 },
        headers: { 'content-type': 'application/json' },
      });
      const id = started.json().id;
      await waitDone(sessions, id);
      for (const kind of ['thin-content', 'missing-og', 'duplicate-content']) {
        const res = await app.inject({ method: 'GET', url: `/api/crawl/${id}/pages?issue=${kind}` });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toHaveProperty('total');
      }
    } finally { await site.close(); }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/server -- src/api/routes.test.ts`
Expected: FAIL — `thinContentThreshold` undefined, `?issue=thin-content` → 400.

- [ ] **Step 3: Write minimal implementation**

В `apps/server/src/api/routes.ts`:

1) `ISSUE_KINDS` — полный список (7 старых + 4 из подсистемы A + 2 новых):

```ts
const ISSUE_KINDS: IssueKind[] = [
  'broken-link', 'duplicate-title', 'duplicate-description',
  'duplicate-h1', 'missing-h1', 'missing-alt', 'noindex',
  'missing-og', 'missing-favicon', 'missing-lang', 'heading-order',
  'thin-content', 'duplicate-content',
];
```

2) `parseCrawlOptions` — перед `return { ok: true, ... }`:

```ts
  let thinContentThreshold = 100;
  if (b.thinContentThreshold !== undefined) {
    const v = inRange(b.thinContentThreshold, 0, 10000);
    if (v === null) return { ok: false, message: 'thinContentThreshold должен быть целым числом от 0 до 10000' };
    thinContentThreshold = v;
  }
```

и в `value` добавить `thinContentThreshold,`.

3) Сигнатура `pagesInIssueGroup`:

```ts
function pagesInIssueGroup(
  results: PageResult[],
  linkStatuses: Map<string, number | null>,
  kind: IssueKind,
  extras: { textHashes?: Map<string, string>; thinContentThreshold: number },
): Set<string> {
```

Перед циклом `for (const p of results)`:

```ts
  const duplicateUrls = new Set(
    extras.textHashes
      ? findDuplicateGroups(extras.textHashes).flat()
      : [],
  );
  const isHtml = (p: PageResult): boolean =>
    p.status !== null && (p.contentType ?? '').startsWith('text/html');
```

Новые кейсы в `switch` (после `case 'noindex'`):

```ts
      case 'missing-og':
        hit = p.openGraph === null
          || (p.openGraph.title === null && p.openGraph.description === null);
        break;
      case 'missing-favicon':
        hit = p.favicon === null;
        break;
      case 'missing-lang':
        hit = p.lang === null;
        break;
      case 'heading-order':
        hit = isHeadingOrderBroken(p.headingOrder);
        break;
      case 'thin-content':
        hit = isHtml(p) && p.wordCount < extras.thinContentThreshold;
        break;
      case 'duplicate-content':
        hit = duplicateUrls.has(p.url);
        break;
```

В начале файла добавить импорты:

```ts
import { findDuplicateGroups } from '../crawler/simhash';
import { isHeadingOrderBroken } from '../crawler/issues';
```

В `issues.ts` сделать экспорт: `export function isHeadingOrderBroken(...)` (сейчас `function`).

4) Вызов (строка ~219):

```ts
      const inGroup = pagesInIssueGroup(
        [...session.results.values()],
        session.linkStatuses,
        issue,
        { textHashes: session.textHashes, thinContentThreshold: session.options.thinContentThreshold },
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/server -- src/api/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/api/routes.ts apps/server/src/api/routes.test.ts apps/server/src/crawler/issues.ts
git commit -m "feat: фильтр issue и валидация порога thin-content в API (+ фикс проводки проверок подсистемы A)"
```

---

### Task 9: Фронтенд — блок «Ключевые слова», локализация issues

**Files:**
- Modify: `apps/web/src/components/PageDetails.tsx` (блок после favicon-секции, ~строка 267)
- Modify: `apps/web/src/views/CrawlView.tsx:19-31` (ISSUE_LABELS)
- Modify: `apps/web/src/locales/ru.json`, `apps/web/src/locales/en.json`
- Test: `apps/web/src/components/PageDetails.test.tsx`

**Interfaces:**
- Consumes: `PageResult.topWords` (Task 2), `IssueKind 'thin-content' | 'duplicate-content'` (Task 2).
- Produces: UI-отображение; CSV и таблица не меняются.

- [ ] **Step 1: Write the failing test**

В `apps/web/src/components/PageDetails.test.tsx` (посмотреть существующие фикстуры `PageResult` — дополнить базовую фикстуру полем `topWords: []`, иначе tsc упадёт) добавить:

```tsx
it('показывает ключевые слова страницы', () => {
  // фикстура страницы с topWords
  const page = makePage({ topWords: [{ word: 'каталог', count: 12 }, { word: 'товар', count: 5 }] });
  const wrapper = mountDetails(page);
  const block = wrapper.find('[data-test=details-topwords]');
  expect(block.exists()).toBe(true);
  expect(block.text()).toContain('каталог');
  expect(block.text()).toContain('12');
});

it('показывает прочерк при пустом topWords', () => {
  const wrapper = mountDetails(makePage({ topWords: [] }));
  expect(wrapper.find('[data-test=details-topwords-empty]').exists()).toBe(true);
});
```

(Имена helper'ов (`makePage`, `mountDetails`) адаптировать к файлу.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @seo-crawler/web -- src/components/PageDetails.test.tsx`
Expected: FAIL — блока нет.

- [ ] **Step 3: Write minimal implementation**

`PageDetails.tsx` — после секции favicon (перед `</aside>`):

```tsx
        <div class="pd-section">
          <h4>{t('details.topWords')}</h4>
          {props.page.topWords.length === 0 ? (
            <p class="pd-muted" data-test="details-topwords-empty">—</p>
          ) : (
            <ul class="pd-list" data-test="details-topwords">
              {props.page.topWords.map((w) => (
                <li key={w.word}>{`${w.word} — ${w.count}`}</li>
              ))}
            </ul>
          )}
        </div>
```

`CrawlView.tsx` — в `ISSUE_LABELS` добавить:

```ts
  'thin-content': 'issues.thinContent',
  'duplicate-content': 'issues.duplicateContent',
```

`ru.json` → `issues`:

```json
    "thinContent": "Мало текста (thin-content)",
    "duplicateContent": "Дубли контента",
```

`ru.json` → `details`:

```json
    "topWords": "Ключевые слова",
```

`en.json` → `issues`:

```json
    "thinContent": "Thin content",
    "duplicateContent": "Duplicate content",
```

`en.json` → `details`:

```json
    "topWords": "Top keywords",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @seo-crawler/web -- src/components/PageDetails.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PageDetails.tsx apps/web/src/components/PageDetails.test.tsx apps/web/src/views/CrawlView.tsx apps/web/src/locales/ru.json apps/web/src/locales/en.json
git commit -m "feat: блок ключевых слов в деталях страницы, локализация новых issues"
```

---

### Task 10: Финальная проверка

- [ ] **Step 1: Прогнать все тесты**

```bash
npm test
```

Expected: все воркспейсы PASS.

- [ ] **Step 2: Проверить типы/сборку**

```bash
npx tsc --noEmit -p apps/server && npx tsc --noEmit -p apps/web
```

Expected: без ошибок.

- [ ] **Step 3: Ручная проверка стенда (опционально, по памяти: tsx без watch, сеть через прокси 127.0.0.1:50430)**

Запустить `npm run dev`, просканировать небольшой сайт с порогом thin-content=50 и убедиться: поле порога в форме, группы «Мало текста»/«Дубли контента» в панели проблем, фильтр по ним, блок «Ключевые слова» в деталях.

- [ ] **Step 4: Финальный коммит (если что-то осталось несохранённым)**

```bash
git status --short
```

Expected: чисто.
