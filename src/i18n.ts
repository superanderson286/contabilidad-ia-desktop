import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { invoke } from '@tauri-apps/api/core';

// Import translation files
import enTranslation from './locales/en/translation.json';
import esTranslation from './locales/es/translation.json';

const resources = {
  en: {
    translation: enTranslation,
  },
  es: {
    translation: esTranslation,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en', // Fallback language if detection fails or no translation is found
    interpolation: {
      escapeValue: false, // React already escapes by default
    },
    detection: {
      order: ['tauriDetector', 'navigator'], // Prioritize Tauri detection
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

// Custom language detector for Tauri
i18n.services.languageDetector?.addDetector({
  name: 'tauriDetector',
  lookup(options) {
    return new Promise((resolve) => {
      invoke('get_system_locale').then((locale: unknown) => {
        if (typeof locale === 'string') {
          // Extract primary language (e.g., "en" from "en-US")
          const primaryLang = locale.split('-')[0];
          resolve(primaryLang);
        } else {
          resolve(undefined); // Fallback to other detectors
        }
      }).catch(() => {
        resolve(undefined); // Fallback to other detectors on error
      });
    });
  },
});

export default i18n;