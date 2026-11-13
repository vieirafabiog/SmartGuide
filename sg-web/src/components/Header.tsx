// ==============================================================================
// Componente: Header (Barra de Navegação Superior)
// Usa SafeAreaInsets para evitar sobreposição com a status bar no celular
// ==============================================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';

export const Header: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  // Pega a altura da status bar para evitar sobreposição
  const insets = useSafeAreaInsets();

  const handleLogout = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  const isCompanyAdmin = user?.role === 'company_admin' || user?.role === 'super_admin';

  // Altura extra no topo apenas em dispositivos móveis (não no web)
  const topPadding = Platform.OS !== 'web' ? insets.top : 0;

  return (
    <View style={[styles.header, { paddingTop: topPadding + 10, height: 60 + topPadding }]}>
      {/* Logotipo e Título */}
      <TouchableOpacity
        style={styles.logoContainer}
        onPress={() => router.push('/(tabs)')}
        activeOpacity={0.8}
      >
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <View>
          <Text style={styles.appTitle}>Smart Guide</Text>
          <Text style={styles.appSubtitle}>Treinamentos Corporativos</Text>
        </View>
      </TouchableOpacity>

      {/* Menu de Navegação Superior (Web / Tablets) */}
      <View style={styles.navLinks}>
        <TouchableOpacity
          style={[styles.navBtn, pathname === '/' || pathname === '/(tabs)' ? styles.navBtnActive : null]}
          onPress={() => router.push('/(tabs)')}
        >
          <Text
            style={[
              styles.navBtnText,
              pathname === '/' || pathname === '/(tabs)' ? styles.navBtnTextActive : null,
            ]}
          >
            Treinamentos
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, pathname?.includes('my-trainings') ? styles.navBtnActive : null]}
          onPress={() => router.push('/(tabs)/my-trainings')}
        >
          <Text
            style={[
              styles.navBtnText,
              pathname?.includes('my-trainings') ? styles.navBtnTextActive : null,
            ]}
          >
            Meus Treinamentos
          </Text>
        </TouchableOpacity>

        {isCompanyAdmin && (
          <TouchableOpacity
            style={[styles.navBtn, pathname?.includes('admin') ? styles.navBtnActive : null]}
            onPress={() => router.push('/(tabs)/admin')}
          >
            <Text
              style={[
                styles.navBtnText,
                pathname?.includes('admin') ? styles.navBtnTextActive : null,
              ]}
            >
              Gerenciamento
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Informações do Usuário e Botão Sair */}
      <View style={styles.userSection}>
        {user && (
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>
              {user.name}
            </Text>
            <View
              style={[
                styles.roleBadge,
                user.role === 'creator'
                  ? { backgroundColor: '#EEF2FF' }
                  : user.role === 'company_admin' || user.role === 'super_admin'
                  ? { backgroundColor: '#FEE2E2' }
                  : null,
              ]}
            >
              <Text
                style={[
                  styles.roleBadgeText,
                  user.role === 'creator'
                    ? { color: '#4F46E5' }
                    : user.role === 'company_admin' || user.role === 'super_admin'
                    ? { color: '#DC2626' }
                    : null,
                ]}
              >
                {user.role === 'super_admin'
                  ? 'SUPER ADMIN'
                  : user.role === 'company_admin'
                  ? 'ADMIN EMPRESA'
                  : user.role === 'creator'
                  ? 'CRIADOR'
                  : 'COLABORADOR'}
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Sair</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    zIndex: 10,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoImage: {
    width: 34,
    height: 34,
  },
  appTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
  },
  appSubtitle: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  navLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // No mobile as abas inferiores cuidam da navegação
    display: Platform.OS === 'web' ? 'flex' : 'none',
  },
  navBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  navBtnActive: {
    backgroundColor: colors.primaryLight,
  },
  navBtnText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  navBtnTextActive: {
    color: colors.primaryHover,
    fontWeight: '700',
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  userInfo: {
    alignItems: 'flex-end',
  },
  userName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    maxWidth: 140,
  },
  roleBadge: {
    backgroundColor: colors.borderLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    marginTop: 2,
  },
  roleBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  logoutBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  logoutBtnText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '600',
  },
});
