import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n, { changeLanguage, use as registerI18nPlugin } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { authService } from '@/services/auth.service';
import type { SupportedLocale } from '@/types/database';
import en from './locales/en.json';
import es from './locales/es.json';
import ptBR from './locales/pt-BR.json';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['pt-BR', 'en', 'es'] as const;
const STORAGE_LOCALE_KEY = '@sg/locale';

export const resources = {
  'pt-BR': { translation: ptBR },
  en: { translation: en },
  es: { translation: es },
} as const;

export function normalizeSupportedLocale(raw: string | null | undefined): SupportedLocale | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace('_', '-').toLowerCase();
  if (!cleaned) return null;

  if (cleaned === 'pt' || cleaned.startsWith('pt-')) return 'pt-BR';
  if (cleaned === 'es' || cleaned.startsWith('es-')) return 'es';
  if (cleaned === 'en' || cleaned.startsWith('en-')) return 'en';
  return null;
}

export function detectDeviceLocale(): SupportedLocale | null {
  try {
    const locales = Localization.getLocales();
    for (const entry of locales) {
      const matched =
        normalizeSupportedLocale(entry.languageTag) ??
        normalizeSupportedLocale(entry.languageCode);
      if (matched) return matched;
    }
  } catch {
    // Fallback below for non-browser / SSR environments
  }

  if (typeof navigator !== 'undefined') {
    const browserList = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of browserList) {
      const matched = normalizeSupportedLocale(lang);
      if (matched) return matched;
    }
  }

  return null;
}

export function resolveInitialLocale(
  savedLocale?: string | null,
  envDefaultLocale?: string | null,
): SupportedLocale {
  return (
    normalizeSupportedLocale(savedLocale) ??
    detectDeviceLocale() ??
    normalizeSupportedLocale(envDefaultLocale) ??
    'en'
  );
}

const syncBootLocale = resolveInitialLocale(null, process.env.EXPO_PUBLIC_DEFAULT_LOCALE);

if (!i18n.isInitialized) {
  void registerI18nPlugin(initReactI18next).init({
    resources,
    lng: syncBootLocale,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
}

let initPromise: Promise<SupportedLocale> | null = null;

export async function initI18n(): Promise<SupportedLocale> {
  if (!initPromise) {
    initPromise = (async () => {
      let saved: string | null = null;
      try {
        saved = await AsyncStorage.getItem(STORAGE_LOCALE_KEY);
      } catch {
        // Ignore AsyncStorage read errors during SSR/static export
      }

      const resolved = resolveInitialLocale(saved, process.env.EXPO_PUBLIC_DEFAULT_LOCALE);
      if (i18n.language !== resolved) {
        await changeLanguage(resolved);
      }
      return resolved;
    })();
  }
  return initPromise;
}

export async function changeAppLanguage(
  locale: SupportedLocale,
  options?: { syncProfile?: boolean },
): Promise<void> {
  const normalized = normalizeSupportedLocale(locale) ?? 'en';

  try {
    await AsyncStorage.setItem(STORAGE_LOCALE_KEY, normalized);
  } catch {
    // Non-fatal if storage is unavailable
  }

  if (i18n.language !== normalized) {
    await changeLanguage(normalized);
  }

  if (options?.syncProfile !== false) {
    await authService.updatePreferredLocale(normalized);
  }
}

export async function syncLocaleFromProfile(
  profileLocale?: SupportedLocale | null,
): Promise<void> {
  const normalized = normalizeSupportedLocale(profileLocale);
  if (!normalized) return;

  try {
    const saved = await AsyncStorage.getItem(STORAGE_LOCALE_KEY);
    if (normalizeSupportedLocale(saved)) {
      return;
    }
  } catch {
    // Proceed to apply profile locale
  }

  if (i18n.language !== normalized) {
    await changeLanguage(normalized);
  }
}

export function getActiveLocale(): SupportedLocale {
  return normalizeSupportedLocale(i18n.language) ?? 'en';
}

export default i18n;
