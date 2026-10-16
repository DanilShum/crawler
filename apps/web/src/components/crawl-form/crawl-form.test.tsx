import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import CrawlForm from './crawl-form';
import ru from '../../locales/ru.json';
import en from '../../locales/en.json';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

function mountForm(onSubmit: Mock<() => void> = vi.fn()) {
  return mount(CrawlForm, {
    props: { onSubmit },
    global: { plugins: [i18n] },
  });
}

describe('CrawlForm', () => {
  it('рендерит поля формы со значениями по умолчанию', () => {
    const wrapper = mountForm();
    expect(wrapper.find('input[name="startUrl"]').exists()).toBe(true);
    const spider = wrapper.find('input[name="mode"][value="spider"]').element as HTMLInputElement;
    expect(spider.checked).toBe(true);
    expect(wrapper.find('input[name="mode"][value="list"]').exists()).toBe(true);
    expect(wrapper.find('input[name="mode"][value="sitemap"]').exists()).toBe(true);
    expect((wrapper.find('input[name="maxUrls"]').element as HTMLInputElement).value).toBe('500');
    expect((wrapper.find('input[name="maxDepth"]').element as HTMLInputElement).value).toBe('10');
    expect((wrapper.find('input[name="respectRobots"]').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.find('input[name="renderJs"]').element as HTMLInputElement).checked).toBe(false);
    expect((wrapper.find('input[name="concurrency"]').element as HTMLInputElement).value).toBe('5');
    expect(
      (wrapper.find('input[name="requestTimeoutMs"]').element as HTMLInputElement).value,
    ).toBe('15000');
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
  });

  it('невалидный URL: ошибка под полем, onSubmit не вызван', async () => {
    const onSubmit = vi.fn();
    const wrapper = mountForm(onSubmit);
    await wrapper.find('input[name="startUrl"]').setValue('example.com');
    await wrapper.find('form').trigger('submit');
    const error = wrapper.find('[data-test="error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toBe(i18n.global.t('form.startUrlError'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('валидный сабмит вызывает onSubmit с полными CrawlOptions и блокирует кнопку', async () => {
    const onSubmit = vi.fn();
    const wrapper = mountForm(onSubmit);
    await wrapper.find('input[name="startUrl"]').setValue('https://example.com');
    await wrapper.find('form').trigger('submit');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      startUrl: 'https://example.com',
      mode: 'spider',
      maxUrls: 500,
      maxDepth: 10,
      respectRobots: true,
      renderJs: false,
      concurrency: 5,
      requestTimeoutMs: 15000,
    });
    const button = wrapper.find('button[type="submit"]').element as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('переключение режима на list показывает textarea со списком URL', async () => {
    const wrapper = mountForm();
    expect(wrapper.find('textarea[name="listUrls"]').exists()).toBe(false);
    await wrapper.find('input[name="mode"][value="list"]').setValue(true);
    expect(wrapper.find('textarea[name="listUrls"]').exists()).toBe(true);
    expect(wrapper.find('input[type="file"][accept=".csv"]').exists()).toBe(true);
    await wrapper.find('input[name="mode"][value="spider"]').setValue(true);
    expect(wrapper.find('textarea[name="listUrls"]').exists()).toBe(false);
  });

  it('list с пустым списком: ошибка, onSubmit не вызван', async () => {
    const onSubmit = vi.fn();
    const wrapper = mountForm(onSubmit);
    await wrapper.find('input[name="startUrl"]').setValue('https://example.com');
    await wrapper.find('input[name="mode"][value="list"]').setValue(true);
    await wrapper.find('form').trigger('submit');
    expect(onSubmit).not.toHaveBeenCalled();
    const error = wrapper.find('[data-test="error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toBe(i18n.global.t('form.listUrlsEmpty'));
  });

  it('list с URL из textarea: onSubmit вызван с listUrls', async () => {
    const onSubmit = vi.fn();
    const wrapper = mountForm(onSubmit);
    await wrapper.find('input[name="startUrl"]').setValue('https://example.com');
    await wrapper.find('input[name="mode"][value="list"]').setValue(true);
    await wrapper
      .find('textarea[name="listUrls"]')
      .setValue('https://a.com/1\n\nhttps://a.com/2,extra\n');
    await wrapper.find('form').trigger('submit');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'list',
        listUrls: ['https://a.com/1', 'https://a.com/2,extra'],
      }),
    );
  });

  it('ошибка чтения CSV-файла показывает ошибку под полем списка', async () => {
    const onSubmit = vi.fn();
    const wrapper = mountForm(onSubmit);
    await wrapper.find('input[name="mode"][value="list"]').setValue(true);

    // Стаб FileReader, который сразу завершается ошибкой чтения файла.
    class FakeFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsText(): void {
        this.onerror?.();
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader as unknown as typeof FileReader);

    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      value: [{ name: 'broken.csv' }],
      configurable: true,
    });
    await input.trigger('change');

    const error = wrapper.find('[data-test="error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toBe(i18n.global.t('form.fileReadError'));
    expect(onSubmit).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('число вне диапазона: ошибка под полем, onSubmit не вызван', async () => {
    const onSubmit = vi.fn();
    const wrapper = mountForm(onSubmit);
    await wrapper.find('input[name="startUrl"]').setValue('https://example.com');
    await wrapper.find('input[name="maxUrls"]').setValue('0');
    await wrapper.find('form').trigger('submit');
    expect(onSubmit).not.toHaveBeenCalled();
    const error = wrapper.find('[data-test="error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toBe(i18n.global.t('form.numberError', { min: 1, max: 10000 }));
  });
});
