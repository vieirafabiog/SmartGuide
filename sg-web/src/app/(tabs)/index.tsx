// ==============================================================================
// Tela Principal: Treinamentos (HomeScreen)
// Réplica aprimorada do Power Apps com filtro de categorias, busca e cards
// ==============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { trainingsService } from '../../services/trainings.service';
import { categoriesService } from '../../services/categories.service';
import { Training, Category } from '../../types/database';
import { TrainingCard } from '../../components/TrainingCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineService } from '../../services/offline.service';

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();

  const [trainings, setTrainings] = useState<Training[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [downloadedIds, setDownloadedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const loadDownloadedStatus = async () => {
    try {
      const idx = await AsyncStorage.getItem('@smartguide_offline_trainings_index');
      if (idx) {
        setDownloadedIds(JSON.parse(idx));
      } else {
        setDownloadedIds([]);
      }
    } catch {
      setDownloadedIds([]);
    }
  };

  // Efeito DelayOutput: aguarda 400ms após o usuário parar de digitar antes de disparar a busca
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 400);

    return () => {
      clearTimeout(handler);
    };
  }, [searchText]);

  // Calcula número de colunas responsivo
  const isWebWide = width >= 900;
  const isTablet = width >= 600 && width < 900;
  const cardWidth = isWebWide ? '31.5%' : isTablet ? '48%' : '100%';

  // Carrega as categorias da instância
  const loadCategories = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return;
      }
      const data = await categoriesService.getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Erro ao carregar categorias:', error);
    }
  };

  // Carrega os treinamentos disponíveis (com suporte offline instantâneo)
  const loadTrainings = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Carrega imediatamente os treinamentos baixados offline
      const offlineTrainings = await offlineService.getAllOfflineTrainings();
      if (offlineTrainings.length > 0) {
        setDownloadedIds(offlineTrainings.map((t) => t.id));
      }

      // Se comprovadamente sem conexão, exibe imediatamente os offline sem esperar rede
      const isDefinitelyOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isDefinitelyOffline) {
        setIsOfflineMode(true);
        if (offlineTrainings.length > 0) {
          setTrainings(offlineTrainings);
        }
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // 2. Busca online com timeout de segurança (3.5 segundos)
      const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) =>
        setTimeout(() => resolve({ isTimeout: true }), 3500)
      );

      const fetchPromise = trainingsService.getTrainings({
        categoryId: selectedCategoryId ?? undefined,
        search: debouncedSearchText || undefined,
        status: 'published',
      });

      const raceRes = await Promise.race([fetchPromise, timeoutPromise]);

      if (!Array.isArray(raceRes) && 'isTimeout' in raceRes) {
        console.warn('[HomeScreen] Rede lenta ou inacessível. Ativando exibição offline.');
        setIsOfflineMode(true);
        if (offlineTrainings.length > 0) {
          setTrainings(offlineTrainings);
        }
      } else {
        setIsOfflineMode(false);
        const fetched = Array.isArray(raceRes) ? raceRes : [];
        if (fetched.length > 0) {
          setTrainings(fetched);
        } else if (offlineTrainings.length > 0 && !selectedCategoryId && !debouncedSearchText) {
          setTrainings(offlineTrainings);
        } else {
          setTrainings(fetched);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar treinamentos:', error);
      const offlineTrainings = await offlineService.getAllOfflineTrainings();
      if (offlineTrainings.length > 0) {
        setTrainings(offlineTrainings);
        setIsOfflineMode(true);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCategoryId, debouncedSearchText]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadCategories();
        void loadDownloadedStatus();
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadTrainings();
        void loadDownloadedStatus();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadTrainings]);

  const onRefresh = () => {
    setRefreshing(true);
    loadCategories();
    loadDownloadedStatus();
    loadTrainings();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Banner de Boas-Vindas */}
      <View style={styles.banner}>
        <View>
          <Text style={styles.greetingTitle}>{t('home.greeting', { name: user?.name || 'User' })}</Text>
          <Text style={styles.greetingSubtitle}>{t('catalog.subtitle')}</Text>
        </View>

        {/* Botão de Criação para Administradores e Criadores */}
        {(user?.role === 'admin' || user?.role === 'creator') && (
          <TouchableOpacity
            style={styles.newTrainingBtn}
            onPress={() => router.push('/training/create')}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color={colors.textInverse} />
            <Text style={styles.newTrainingBtnText}>{t('training.create.title')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Banner de Modo Offline */}
      {isOfflineMode && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline" size={18} color="#FFF" />
          <Text style={styles.offlineBannerText}>{t('catalog.offlineModeBanner')}</Text>
        </View>
      )}

      {/* Barra de Pesquisa e Filtros */}
      <View style={styles.filterSection}>
        {/* Campo de Busca */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('catalog.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={searchText}
            onChangeText={setSearchText}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Pílulas de Categorias */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryPills}
        >
          <TouchableOpacity
            style={[styles.pill, selectedCategoryId === null && styles.pillActive]}
            onPress={() => setSelectedCategoryId(null)}
          >
            <Text
              style={[styles.pillText, selectedCategoryId === null && styles.pillTextActive]}
            >
              {t('catalog.allCategories')}
            </Text>
          </TouchableOpacity>

          {categories.map((cat) => {
            const isSelected = selectedCategoryId === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.pill,
                  isSelected && { backgroundColor: cat.color, borderColor: cat.color },
                ]}
                onPress={() => setSelectedCategoryId(isSelected ? null : cat.id)}
              >
                <Text style={[styles.pillText, isSelected && styles.pillTextActive]}>
                  {cat.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Grid de Cards de Treinamento */}
      {loading ? (
        <View style={styles.loadingArea}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t('common.loading')}</Text>
        </View>
      ) : trainings.length === 0 ? (
        <View style={styles.emptyArea}>
          <Ionicons name="school-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{t('catalog.emptyTitle')}</Text>
          <Text style={styles.emptySubtitle}>{t('catalog.emptySubtitle')}</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {trainings.map((training) => (
            <View key={training.id} style={{ width: cardWidth }}>
              <TrainingCard
                training={training}
                isDownloaded={downloadedIds.includes(training.id)}
                onPress={() =>
                  router.push({
                    pathname: `/training/${training.id}`,
                    params: { fromTrainings: 'true' },
                  } as any)
                }
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 80,
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
  },
  banner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  greetingTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  greetingSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  newTrainingBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 3,
    gap: 6,
  },
  newTrainingBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 13,
  },
  filterSection: {
    marginBottom: 20,
  },
  searchBar: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  categoryPills: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  pill: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  pillTextActive: {
    color: colors.textInverse,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  loadingArea: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: colors.textSecondary,
  },
  emptyArea: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  offlineBanner: {
    backgroundColor: '#D97706',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    marginBottom: 16,
  },
  offlineBannerText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});
