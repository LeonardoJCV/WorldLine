import { useCallback } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { en, type MessageKey } from './en.ts'
import { ptBR } from './pt-BR.ts'

export const LOCALES = ['en', 'pt-BR'] as const
export type Locale = (typeof LOCALES)[number]
export type Params = Readonly<Record<string, string | number>>

const DICTIONARIES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  en,
  'pt-BR': ptBR,
}
const STORAGE_KEY = 'worldline.locale'

export function detectLocale(stored: string | null, languages: readonly string[]): Locale {
  if (stored === 'en' || stored === 'pt-BR') return stored
  return languages.some((language) => language.toLowerCase().startsWith('pt')) ? 'pt-BR' : 'en'
}

export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
  return DICTIONARIES[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name]
    return value === undefined ? placeholder : String(value)
  })
}

function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

interface LocaleState {
  readonly locale: Locale
  setLocale(locale: Locale): void
}

export const localeStore = createStore<LocaleState>()((set) => ({
  locale: detectLocale(
    readStoredLocale(),
    typeof navigator === 'undefined' ? [] : navigator.languages,
  ),
  setLocale(locale) {
    set({ locale })
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      // armazenamento bloqueado: a escolha vale só nesta sessão
    }
  },
}))

export function useLocale(): Locale {
  return useStore(localeStore, (state) => state.locale)
}

export function useT(): (key: MessageKey, params?: Params) => string {
  const locale = useLocale()
  return useCallback((key: MessageKey, params?: Params) => translate(locale, key, params), [locale])
}
