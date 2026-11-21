import { beforeAll, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { normalize } from '@/lib/text'
import { formatList, i18n } from '@/locale'
import { settings } from '@/stores/settings'

describe('normalize', () => {
  it('folds hamza forms, taa marbuta, alef maqsura and diacritics', () => {
    expect(normalize('أَسْئِلَة')).toBe(normalize('اسئله'))
    expect(normalize('مُصطفى')).toBe(normalize('مصطفي'))
  })

  it('ignores Latin case', () => {
    expect(normalize('Bug')).toBe('bug')
  })
})

describe('Arabic text', () => {
  const { t } = i18n.global

  beforeAll(async () => {
    settings.locale = 'ar'
    await nextTick()
  })

  it.each([
    [0, 'لا نتائج'],
    [1, 'نتيجة واحدة'],
    [2, 'نتيجتان'],
    [3, '3 نتائج'],
    [11, '11 نتيجة'],
    [100, '100 نتيجة'],
    [1304, '1304 نتائج'],
  ])('writes %i results as «%s»', (count, text) => {
    expect(t('results.count', { n: count }, count)).toBe(text)
  })

  it('lists names with the Arabic comma', () => {
    expect(formatList(['ali', 'omar'])).toBe('ali، omar')
  })

  it('names the page in Arabic', () => {
    expect(document.title).toBe('زمام')
    expect(document.documentElement.dir).toBe('rtl')
  })
})
