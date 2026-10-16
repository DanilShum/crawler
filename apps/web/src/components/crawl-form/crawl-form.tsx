import { defineComponent, ref, type PropType, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CrawlMode, CrawlOptions } from '@seo-crawler/shared';

type SubmitHandler = (options: CrawlOptions) => void | Promise<void>;

const MODES: CrawlMode[] = ['spider', 'list', 'sitemap'];

const NUMBER_LIMITS = {
  maxUrls: { min: 1, max: 10000, def: '500' },
  maxDepth: { min: 0, max: 20, def: '10' },
  concurrency: { min: 1, max: 20, def: '5' },
  requestTimeoutMs: { min: 1000, max: 120000, def: '15000' },
} as const;

type NumberField = keyof typeof NUMBER_LIMITS;
type FieldName = NumberField | 'startUrl' | 'listUrls';

export default defineComponent({
  name: 'CrawlForm',
  props: {
    onSubmit: {
      type: Function as PropType<SubmitHandler>,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18n();

    const startUrl = ref('');
    const mode = ref<CrawlMode>('spider');
    const listUrlsText = ref('');
    const respectRobots = ref(true);
    const renderJs = ref(false);
    const nums: Record<NumberField, Ref<string>> = {
      maxUrls: ref(NUMBER_LIMITS.maxUrls.def),
      maxDepth: ref(NUMBER_LIMITS.maxDepth.def),
      concurrency: ref(NUMBER_LIMITS.concurrency.def),
      requestTimeoutMs: ref(NUMBER_LIMITS.requestTimeoutMs.def),
    };
    const errors = ref<Partial<Record<FieldName, string>>>({});
    const submitted = ref(false);

    function parseList(): string[] {
      return listUrlsText.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }

    // CSV: первая колонка каждой строки (split по запятой), пустые — пропускаем
    function parseCsv(text: string): string[] {
      return text
        .split(/\r?\n/)
        .map((line) => (line.split(',')[0] ?? '').trim())
        .filter((url) => url.length > 0);
    }

    function onFileChange(e: Event) {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        listUrlsText.value = parseCsv(String(reader.result ?? '')).join('\n');
      };
      reader.onerror = () => {
        errors.value.listUrls = t('form.fileReadError');
      };
      reader.readAsText(file);
      input.value = '';
    }

    function validate(): Partial<Record<FieldName, string>> {
      const errs: Partial<Record<FieldName, string>> = {};
      if (!/^https?:\/\//.test(startUrl.value.trim())) {
        errs.startUrl = t('form.startUrlError');
      }
      if (mode.value === 'list' && parseList().length === 0) {
        errs.listUrls = t('form.listUrlsEmpty');
      }
      for (const field of Object.keys(NUMBER_LIMITS) as NumberField[]) {
        const { min, max } = NUMBER_LIMITS[field];
        const raw = nums[field].value.trim();
        const value = raw === '' ? null : Number(raw);
        if (value === null || !Number.isInteger(value) || value < min || value > max) {
          errs[field] = t('form.numberError', { min, max });
        }
      }
      return errs;
    }

    function buildOptions(): CrawlOptions {
      const options: CrawlOptions = {
        startUrl: startUrl.value.trim(),
        mode: mode.value,
        maxUrls: Number(nums.maxUrls.value.trim()),
        maxDepth: Number(nums.maxDepth.value.trim()),
        respectRobots: respectRobots.value,
        renderJs: renderJs.value,
        concurrency: Number(nums.concurrency.value.trim()),
        requestTimeoutMs: Number(nums.requestTimeoutMs.value.trim()),
      };
      if (mode.value === 'list') options.listUrls = parseList();
      return options;
    }

    function handleSubmit(e: Event) {
      e.preventDefault();
      if (submitted.value) return;
      const errs = validate();
      errors.value = errs;
      if (Object.keys(errs).length > 0) return;
      submitted.value = true; // защита от дабл-клика
      const result: unknown = props.onSubmit(buildOptions());
      if (result instanceof Promise) {
        // при ошибке startCrawl возвращаем кнопку (сообщение показывает NewCrawlView)
        result.catch(() => {
          submitted.value = false;
        });
      }
    }

    return () => (
      <form class="crawl-form" novalidate onSubmit={handleSubmit}>
        <h2>{t('form.title')}</h2>

        <label class="field">
          <span class="caption">{t('form.startUrl')}</span>
          <input
            type="text"
            name="startUrl"
            placeholder={t('form.startUrlPlaceholder')}
            value={startUrl.value}
            onInput={(e: Event) => {
              startUrl.value = (e.target as HTMLInputElement).value;
            }}
          />
        </label>
        {errors.value.startUrl ? (
          <p class="error" data-test="error">
            {errors.value.startUrl}
          </p>
        ) : null}

        <fieldset class="mode-fieldset field">
          <legend class="caption">{t('form.mode')}</legend>
          {MODES.map((m) => (
            <label class="radio" key={m}>
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode.value === m}
                onChange={() => {
                  mode.value = m;
                }}
              />
              {t(`form.mode${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
            </label>
          ))}
        </fieldset>

        {mode.value === 'list' ? (
          <div class="field">
            <label class="caption" for="listUrls">
              {t('form.listUrls')}
            </label>
            <textarea
              id="listUrls"
              name="listUrls"
              rows={6}
              placeholder={t('form.listUrlsPlaceholder')}
              value={listUrlsText.value}
              onInput={(e: Event) => {
                listUrlsText.value = (e.target as HTMLTextAreaElement).value;
              }}
            />
            <label class="file-label">
              {t('form.listUrlsFile')}
              <input type="file" accept=".csv" onChange={onFileChange} />
            </label>
          </div>
        ) : null}
        {errors.value.listUrls ? (
          <p class="error" data-test="error">
            {errors.value.listUrls}
          </p>
        ) : null}

        <div class="field-grid">
          {(Object.keys(NUMBER_LIMITS) as NumberField[]).map((field) => (
            <div class="field" key={field}>
              <label class="caption" for={field}>
                {t(`form.${field}`)}
              </label>
              <input
                type="number"
                id={field}
                name={field}
                min={NUMBER_LIMITS[field].min}
                max={NUMBER_LIMITS[field].max}
                step={1}
                value={nums[field].value}
                onInput={(e: Event) => {
                  nums[field].value = (e.target as HTMLInputElement).value;
                }}
              />
              {errors.value[field] ? (
                <p class="error" data-test="error">
                  {errors.value[field]}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <div class="checks">
          <label class="radio">
            <input
              type="checkbox"
              name="respectRobots"
              checked={respectRobots.value}
              onChange={(e: Event) => {
                respectRobots.value = (e.target as HTMLInputElement).checked;
              }}
            />
            {t('form.respectRobots')}
          </label>
          <label class="radio">
            <input
              type="checkbox"
              name="renderJs"
              checked={renderJs.value}
              onChange={(e: Event) => {
                renderJs.value = (e.target as HTMLInputElement).checked;
              }}
            />
            {t('form.renderJs')}
          </label>
        </div>

        <button type="submit" class="btn-primary" disabled={submitted.value}>
          {submitted.value ? t('form.submitting') : t('form.submit')}
        </button>
      </form>
    );
  },
});
