// ==============================================================================
// Componente: Footer (Rodapé do Sistema)
// Exibe versão do app em todas as telas; respeita a navegação do sistema no celular
// ==============================================================================

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { APP_CONFIG } from '../constants/app';

export const Footer: React.FC = () => {
  // Altura da barra de navegação do sistema (botões home/back no Android)
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS !== 'web' ? insets.bottom : 0;

  return (
    <View style={[styles.footer, { paddingBottom: bottomPadding + 6, height: 38 + bottomPadding }]}>
      <Text style={styles.footerText}>{APP_CONFIG.footerText}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
