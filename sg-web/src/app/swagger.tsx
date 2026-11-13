// ==============================================================================
// Tela: Documentação Swagger / OpenAPI (SwaggerScreen)
// Exibe a especificação interativa da API do SmartGuide
// ==============================================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

export default function SwaggerScreen() {
  const router = useRouter();
  const docsUrl = `${(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '')}/docs`;

  const handleOpenInNewTab = () => {
    if (Platform.OS === 'web') {
      window.open(docsUrl, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(docsUrl);
    }
  };

  return (
    <View style={styles.container}>
      <Header />

      {/* Barra de Navegação Superior */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
          <Text style={styles.backBtnText}>Voltar ao Gerenciamento</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.openExternalBtn} onPress={handleOpenInNewTab}>
          <Ionicons name="open-outline" size={16} color={colors.primaryHover} />
          <Text style={styles.openExternalBtnText}>Abrir em Nova Guia ↗</Text>
        </TouchableOpacity>
      </View>

      {Platform.OS === 'web' ? (
        <View style={styles.iframeContainer}>
          <iframe
            src={docsUrl}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            title="SmartGuide Swagger Documentation"
          />
        </View>
      ) : (
        <View style={styles.mobileFallback}>
          <Ionicons name="book-outline" size={64} color={colors.primary} />
          <Text style={styles.mobileTitle}>Documentação Swagger (OpenAPI)</Text>
          <Text style={styles.mobileSubtitle}>
            A documentação interativa com Swagger UI está otimizada para navegadores web.
          </Text>
          <TouchableOpacity style={styles.mobileOpenBtn} onPress={handleOpenInNewTab}>
            <Text style={styles.mobileOpenBtnText}>Abrir Documentação no Navegador</Text>
            <Ionicons name="open-outline" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backBtnText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  openExternalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    backgroundColor: colors.primaryLight,
  },
  openExternalBtnText: {
    fontSize: 13,
    color: colors.primaryHover,
    fontWeight: '600',
  },
  iframeContainer: {
    flex: 1,
    width: '100%',
  },
  mobileFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  mobileTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  mobileSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 340,
  },
  mobileOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
  },
  mobileOpenBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
