import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { UsersTab } from '@/components/admin/UsersTab';
import { CategoriesMetricsTab } from '@/components/admin/CategoriesMetricsTab';
import { ApiKeysTab } from '@/components/admin/ApiKeysTab';
import { InstanceSettingsTab } from '@/components/admin/InstanceSettingsTab';

type AdminTabKey = 'users' | 'metrics' | 'api' | 'settings';

const ADMIN_TABS: { key: AdminTabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'users', label: 'Usuários', icon: 'people-outline' },
  { key: 'metrics', label: 'Métricas & Categorias', icon: 'bar-chart-outline' },
  { key: 'api', label: 'API Keys & Docs', icon: 'key-outline' },
  { key: 'settings', label: 'Instância & QR', icon: 'settings-outline' },
];

export default function ManagementScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTabKey>('users');

  if (user?.role !== 'admin') {
    return (
      <View style={styles.deniedContainer}>
        <Ionicons name="lock-closed-outline" size={44} color={colors.danger} />
        <Text style={styles.deniedTitle}>Acesso Restrito</Text>
        <Text style={styles.deniedText}>
          Apenas administradores da instância podem acessar o painel de gerenciamento.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/' as never)}>
          <Text style={styles.backBtnText}>Voltar para o Início</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerBlock}>
        <Text style={styles.pageTitle}>Gerenciamento da Instância</Text>
        <Text style={styles.pageSubtitle}>
          Controle usuários, categorias, chaves de API e conexão mobile.
        </Text>
      </View>

      <View style={styles.tabBar}>
        {ADMIN_TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={tab.icon}
                size={16}
                color={isActive ? colors.primaryHover : colors.textSecondary}
              />
              <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'users' && <UsersTab currentUserId={user?.id} />}
      {activeTab === 'metrics' && <CategoriesMetricsTab />}
      {activeTab === 'api' && <ApiKeysTab />}
      {activeTab === 'settings' && <InstanceSettingsTab />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    gap: 18,
    paddingBottom: 40,
  },
  headerBlock: {
    gap: 4,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  pageSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  tabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    paddingBottom: 12,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabButtonTextActive: {
    color: colors.primaryHover,
    fontWeight: '700',
  },
  deniedContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  deniedTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  deniedText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 380,
  },
  backBtn: {
    marginTop: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 4,
  },
  backBtnText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 14,
  },
});
