import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/constants/colors';
import { changeAppLanguage, normalizeSupportedLocale } from '@/i18n';
import type { SupportedLocale } from '@/types/database';

const LANGUAGE_OPTIONS: { code: SupportedLocale; shortLabel: string }[] = [
  { code: 'pt-BR', shortLabel: 'PT' },
  { code: 'en', shortLabel: 'EN' },
  { code: 'es', shortLabel: 'ES' },
];

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const activeLocale = normalizeSupportedLocale(i18n.language) ?? 'en';

  const handleSelect = (locale: SupportedLocale) => {
    if (locale === activeLocale) return;
    void changeAppLanguage(locale);
  };

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {LANGUAGE_OPTIONS.map((option) => {
        const isActive = activeLocale === option.code;
        return (
          <TouchableOpacity
            key={option.code}
            style={[styles.pill, isActive && styles.pillActive]}
            onPress={() => handleSelect(option.code)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={option.code}
          >
            <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
              {option.shortLabel}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 2,
    gap: 2,
  },
  containerCompact: {
    alignSelf: 'flex-end',
  },
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 3,
  },
  pillActive: {
    backgroundColor: colors.primary,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.textInverse,
  },
});
