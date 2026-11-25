import { ar as uiAr, en as uiEn } from '@nuxt/ui/locale'
import { computed, watchEffect } from 'vue'
import { createI18n } from 'vue-i18n'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import { settings } from '@/stores/settings'
import { LOCALES, type Locale } from '@/types'

type MessageSchema = typeof en

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema {}
}

const ARABIC_FORMS: Record<Intl.LDMLPluralRule, number> = { zero: 0, one: 1, two: 2, few: 3, many: 4, other: 5 }
const arabicRules = new Intl.PluralRules('ar')

// Arabic counts have six forms: «لا نتائج، نتيجة واحدة، نتيجتان، 3 نتائج، 11 نتيجة، 100 نتيجة».
function arabicPlural(count: number, forms: number): number {
  if (forms < 6) return Math.min(count, forms - 1)
  return ARABIC_FORMS[arabicRules.select(count)]
}

export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  locale: settings.locale,
  fallbackLocale: 'en',
  messages: { ar, en },
  pluralRules: { ar: arabicPlural },
})

const LANGUAGES: Record<Locale, { name: string; dir: 'rtl' | 'ltr'; intl: string; ui: typeof uiEn; comma: string }> = {
  // Arabic text with Western digits, as agreed: `-u-nu-latn` keeps Intl from switching to Arabic-Indic digits.
  ar: { name: 'العربية', dir: 'rtl', intl: 'ar-u-nu-latn', ui: uiAr, comma: '، ' },
  en: { name: 'English', dir: 'ltr', intl: 'en', ui: uiEn, comma: ', ' },
}

const language = computed(() => LANGUAGES[settings.locale])
export const languageName = (locale: Locale) => LANGUAGES[locale].name
export const otherLocale = computed(() => LOCALES.find((locale) => locale !== settings.locale) ?? settings.locale)
const rtl = computed(() => language.value.dir === 'rtl')
// Nuxt UI places panels by physical side, so the reading start and end swap with the language.
export const sides = computed(() =>
  rtl.value ? ({ start: 'right', end: 'left' } as const) : ({ start: 'left', end: 'right' } as const),
)
export const uiLocale = computed(() => language.value.ui)

export function switchLanguage() {
  settings.locale = otherLocale.value
}

watchEffect(() => {
  i18n.global.locale.value = settings.locale
  document.documentElement.lang = settings.locale
  document.documentElement.dir = language.value.dir
  document.title = i18n.global.t('app.name')
})

const numbers = computed(() => new Intl.NumberFormat(language.value.intl))
const relative = computed(() => new Intl.RelativeTimeFormat(language.value.intl, { numeric: 'auto' }))
const dates = computed(() => new Intl.DateTimeFormat(language.value.intl, { dateStyle: 'long', timeStyle: 'short' }))
const clock = computed(() => new Intl.DateTimeFormat(language.value.intl, { timeStyle: 'short' }))
const months = computed(() => new Intl.DateTimeFormat(language.value.intl, { month: 'long', year: 'numeric' }))
const compact = computed(() => new Intl.NumberFormat(language.value.intl, { notation: 'compact' }))

export const formatNumber = (value: number) => numbers.value.format(value)
export const fullDate = (time: string | number) => dates.value.format(new Date(time))
export const clockTime = (time: number) => clock.value.format(new Date(time))
/** A month and its year: «March 2014». */
export const monthYear = (time: string | number) => months.value.format(new Date(time))
/** A number rounded to a short form: «1.2K». */
export const compactNumber = (value: number) => compact.value.format(value)
export const formatList = (values: string[]) => values.join(language.value.comma)

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
]

export function relativeTime(time: number, now: number): string {
  const seconds = Math.round((time - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.value.format(Math.trunc(seconds / size), unit)
  }
  return relative.value.format(0, 'second')
}
