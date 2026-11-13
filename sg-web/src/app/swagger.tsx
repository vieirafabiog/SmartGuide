import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../services/serverConfig.service';

export default function SwaggerScreen() {
  const router = useRouter();
  const { serverUrl } = useAuth();
  const [apiBaseUrl, setApiBaseUrl] = useState(serverUrl || '');

  useEffect(() => {
    let active = true;
    void getApiBaseUrl().then((resolved) => {
      if (active) setApiBaseUrl(resolved);
    });
    return () => {
      active = false;
    };
  }, [serverUrl]);

  const docsUrl = `${apiBaseUrl.replace(/\/+$/, '')}/docs`;

  const handleOpenInNewTab = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(docsUrl, '_blank', 'noopener,noreferrer');
    } else {
      void Linking.openURL(docsUrl);
    }
  };

  return (
    <View style={styles.container}>
      <Header />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
          <Text style={styles.backBtnText}>Voltar ao Gerenciamento</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.openExternalBtn} onPress={handleOpenInNewTab}>
          <Ionicons name="open-outline" size={16} color={colors.primaryHover} />
          <Text style={styles.openExternalBtnText}>Abrir em Nova Guia</Text>
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
            title="Smart Guide Swagger Documentation"
          />
        </View>
      ) : (
        <View style={styles.mobileFallback}>
          <Ionicons name="book-outline" size={64} color={colors.primary} />
          <Text style={styles.mobileTitle}>Documentação Swagger (OpenAPI)</Text>
          <Text style={styles.mobileSubtitle}>
            A documentação interativa com Swagger UI está disponível no navegador.
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
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  openExternalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: colors.primaryLight,
  },
  openExternalBtnText: {
    color: colors.primaryHover,
    fontSize: 13,
    fontWeight: '600',
  },
  iframeContainer: {
    flex: 1,
  },
  mobileFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  mobileTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  mobileSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 340,
  },
  mobileOpenBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 4,
  },
  mobileOpenBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
});
