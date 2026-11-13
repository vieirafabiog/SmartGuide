// ==============================================================================
// Layout das Abas Principais (Tabs Layout)
// Cabeçalho corporativo no topo, navegação central e rodapé com versão
// ==============================================================================

import React, { useEffect } from 'react';
import { View, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';

export default function TabsLayout() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  // Redireciona para o login caso o usuário não esteja autenticado
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/(auth)/login');
    }
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isCompanyAdmin = user?.role === 'company_admin' || user?.role === 'super_admin';

  return (
    <View style={styles.container}>
      {/* Cabeçalho Fixo Superior */}
      <Header />

      {/* Navegador de Abas */}
      <View style={styles.content}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textSecondary,
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.borderLight,
              // Na Web podemos ocultar a barra inferior pois os links já estão no Header
              display: Platform.OS === 'web' ? 'none' : 'flex',
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '600',
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Treinamentos',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="grid-outline" color={color} size={size || 22} />
              ),
            }}
          />

          <Tabs.Screen
            name="my-trainings"
            options={{
              title: 'Meus Treinamentos',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="folder-outline" color={color} size={size || 22} />
              ),
            }}
          />

          <Tabs.Screen
            name="admin"
            options={{
              title: 'Gerenciamento',
              href: isCompanyAdmin ? '/admin' : null,
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="settings-outline" color={color} size={size || 22} />
              ),
            }}
          />
        </Tabs>
      </View>

      {/* Rodapé Fixo com Versão */}
      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
});
