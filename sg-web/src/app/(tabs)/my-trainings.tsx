// ==============================================================================
// Tela: Meus Treinamentos (MyTrainingsScreen)
// Réplica aprimorada do MeusTreinamentos_Screen do Power Apps com gestão de status
// ==============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { trainingsService } from '../../services/trainings.service';
import { Training, TrainingStatus } from '../../types/database';
import { TrainingCard } from '../../components/TrainingCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineService } from '../../services/offline.service';

export default function MyTrainingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();

  const [trainings, setTrainings] = useState<Training[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<TrainingStatus | 'all'>('all');
  const [downloadedIds, setDownloadedIds] = useState<string[]>([]);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isWebWide = width >= 900;
  const isTablet = width >= 600 && width < 900;
  const cardWidth = isWebWide ? '31.5%' : isTablet ? '48%' : '100%';

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

  const loadMyTrainings = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Carrega imediatamente os dados offline do armazenamento local
      const allOffline = await offlineService.getAllOfflineTrainings();
      if (allOffline.length > 0) {
        setDownloadedIds(allOffline.map((t) => t.id));
      }
      const offlineMyTrainings = allOffline.filter(
        (t) => !user?.id || t.created_by === user.id || t.company_id === user.company_id
      );

      // Se estiver comprovadamente offline, exibe na hora sem esperar rede
      const isDefinitelyOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isDefinitelyOffline) {
        setIsOfflineMode(true);
        if (offlineMyTrainings.length > 0) {
          setTrainings(offlineMyTrainings);
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
        companyId: user?.company_id,
        userId: user?.id,
        onlyMyTrainings: true,
        status: selectedStatus === 'all' ? undefined : selectedStatus,
      });

      const raceRes = await Promise.race([fetchPromise, timeoutPromise]);

      if ('isTimeout' in raceRes) {
        console.warn('[MyTrainingsScreen] Conexão lenta ou offline. Exibindo treinamentos locais.');
        setIsOfflineMode(true);
        if (offlineMyTrainings.length > 0) {
          setTrainings(offlineMyTrainings);
        }
      } else {
        setIsOfflineMode(false);
        setTrainings(raceRes?.trainings || []);
      }
    } catch (error) {
      console.error('Erro ao carregar meus treinamentos:', error);
      setIsOfflineMode(true);
      const allOffline = await offlineService.getAllOfflineTrainings();
      if (allOffline.length > 0) {
        setTrainings(allOffline);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.company_id, user?.id, selectedStatus]);

  useEffect(() => {
    loadMyTrainings();
    loadDownloadedStatus();
  }, [loadMyTrainings]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDownloadedStatus();
    loadMyTrainings();
  };

  const handleDelete = (id: string, title: string) => {
    const confirmDelete = async () => {
      const { success, error } = await trainingsService.deleteTraining(id);
      if (success) {
        setTrainings((prev) => prev.filter((t) => t.id !== id));
      } else {
        alert(error || 'Erro ao excluir treinamento.');
      }
    };

    if (typeof window !== 'undefined' && window.confirm) {
      if (window.confirm(`Deseja realmente excluir o treinamento "${title}"?`)) {
        confirmDelete();
      }
    } else {
      Alert.alert('Excluir Treinamento', `Deseja realmente excluir o treinamento "${title}"?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: confirmDelete },
      ]);
    }
  };

  // Editar treinamento com validação de status arquivado
  const handleEditTraining = async (training: Training) => {
    if (training.status === 'archived') {
      const confirmUnarchive = async () => {
        try {
          const { success, error } = await trainingsService.updateTraining(training.id, {
            status: 'draft',
          });
          if (!success) {
            alert(error || 'Não foi possível desarquivar o treinamento.');
            return;
          }
          // Atualiza status local para 'draft'
          setTrainings((prev) =>
            prev.map((t) => (t.id === training.id ? { ...t, status: 'draft' } : t))
          );
          router.push(`/training/${training.id}/edit` as any);
        } catch {
          alert('Erro ao desarquivar treinamento.');
        }
      };

      if (typeof window !== 'undefined' && window.confirm) {
        if (
          window.confirm(
            'Este treinamento está arquivado. Deseja desarquivá-lo para poder editar?'
          )
        ) {
          await confirmUnarchive();
        }
      } else {
        Alert.alert(
          'Treinamento Arquivado',
          'Este treinamento está arquivado. Deseja desarquivá-lo para poder editar?',
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Desarquivar e Editar',
              onPress: confirmUnarchive,
            },
          ]
        );
      }
      return;
    }

    // Se estiver em rascunho ou publicado, edita normalmente
    router.push(`/training/${training.id}/edit` as any);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Cabeçalho da Seção */}
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.screenTitle}>Meus Treinamentos</Text>
          <Text style={styles.screenSubtitle}>
            Gerencie os treinamentos que você criou, edite etapas e acompanhe publicações.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => router.push('/training/create')}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle" size={18} color={colors.textInverse} />
          <Text style={styles.createBtnText}>Criar Treinamento</Text>
        </TouchableOpacity>
      </View>

      {/* Banner de Modo Offline */}
      {isOfflineMode && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline" size={18} color="#FFF" />
          <Text style={styles.offlineBannerText}>
            Modo Offline ativo: exibindo os treinamentos disponíveis no aparelho.
          </Text>
        </View>
      )}

      {/* Filtros por Status (Todos, Publicados, Rascunhos, Arquivados) */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.statusTab, selectedStatus === 'all' && styles.statusTabActive]}
          onPress={() => setSelectedStatus('all')}
        >
          <Text
            style={[styles.statusTabText, selectedStatus === 'all' && styles.statusTabTextActive]}
          >
            Todos
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.statusTab, selectedStatus === 'published' && styles.statusTabActive]}
          onPress={() => setSelectedStatus('published')}
        >
          <Text
            style={[
              styles.statusTabText,
              selectedStatus === 'published' && styles.statusTabTextActive,
            ]}
          >
            Publicados
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.statusTab, selectedStatus === 'draft' && styles.statusTabActive]}
          onPress={() => setSelectedStatus('draft')}
        >
          <Text
            style={[
              styles.statusTabText,
              selectedStatus === 'draft' && styles.statusTabTextActive,
            ]}
          >
            Rascunhos
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.statusTab, selectedStatus === 'archived' && styles.statusTabActive]}
          onPress={() => setSelectedStatus('archived')}
        >
          <Text
            style={[
              styles.statusTabText,
              selectedStatus === 'archived' && styles.statusTabTextActive,
            ]}
          >
            Arquivados
          </Text>
        </TouchableOpacity>
      </View>

      {/* Conteúdo da Lista */}
      {loading ? (
        <View style={styles.loadingArea}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Carregando seus treinamentos...</Text>
        </View>
      ) : trainings.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Nenhum treinamento nesta categoria</Text>
          <Text style={styles.emptySubtitle}>
            Clique em "Criar Treinamento" para elaborar um novo curso com etapas e anexos.
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {trainings.map((training) => (
            <View key={training.id} style={{ width: cardWidth }}>
              <TrainingCard
                training={training}
                showAdminActions={true}
                isDownloaded={downloadedIds.includes(training.id)}
                onPress={() =>
                  router.push({
                    pathname: `/training/${training.id}`,
                    params: { fromTrainings: 'true' },
                  } as any)
                }
                onEditPress={() => handleEditTraining(training)}
              />

              {/* Botão de Excluir */}
              <TouchableOpacity
                style={styles.deleteLink}
                onPress={() => handleDelete(training.id, training.title)}
              >
                <Ionicons name="trash-outline" size={14} color={colors.danger} />
                <Text style={styles.deleteLinkText}>Excluir treinamento</Text>
              </TouchableOpacity>
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
  headerBar: {
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
  screenTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  screenSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  createBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 3,
    gap: 6,
  },
  createBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 13,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  statusTab: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 3,
  },
  statusTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  statusTabText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  statusTabTextActive: {
    color: colors.textInverse,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  deleteLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: -8,
    marginBottom: 16,
  },
  deleteLinkText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
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
  emptyCard: {
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
