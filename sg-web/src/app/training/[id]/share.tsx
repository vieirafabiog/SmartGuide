// ==============================================================================
// Tela: Compartilhamento de Treinamento (ShareTrainingScreen)
// Busca colaboradores com delayOutput (debounce) e gerencia níveis de acesso
// ==============================================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../constants/colors';
import { useAuth } from '../../../context/AuthContext';
import { sharingService } from '../../../services/sharing.service';
import { trainingsService } from '../../../services/trainings.service';
import { Training, TrainingPermission, PermissionLevel, Profile } from '../../../types/database';

// Descrições de cada nível de permissão
const PERMISSION_LABELS: Record<PermissionLevel, { label: string; desc: string; color: string }> = {
  owner: {
    label: 'Proprietário',
    desc: 'Pode criar, editar, compartilhar e excluir o treinamento.',
    color: colors.primary,
  },
  editor: {
    label: 'Editor',
    desc: 'Pode editar etapas e conteúdo, mas não pode excluir nem compartilhar.',
    color: colors.info,
  },
  viewer: {
    label: 'Visualizador',
    desc: 'Pode apenas assistir ao treinamento sem editar nada.',
    color: colors.success,
  },
};

export default function ShareTrainingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const topPadding = Platform.OS !== 'web' ? insets.top + 10 : 16;
  const bottomPadding = Platform.OS !== 'web' ? insets.bottom + 24 : 32;

  const [training, setTraining] = useState<Training | null>(null);
  const [permissions, setPermissions] = useState<TrainingPermission[]>([]);
  const [loading, setLoading] = useState(true);

  // Busca de colaboradores com delayOutput
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);

  // Nível de acesso a conceder
  const [invitePermission, setInvitePermission] = useState<PermissionLevel>('viewer');
  const [inviting, setInviting] = useState(false);

  // Carrega os dados do treinamento e permissões
  const loadData = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [trainingData, permsData] = await Promise.all([
        trainingsService.getTrainingById(id),
        sharingService.getTrainingPermissions(id),
      ]);
      setTraining(trainingData);
      setPermissions(permsData);
    } catch (error) {
      console.error('Erro ao carregar compartilhamentos:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  // Efeito de delayOutput (debounce de 350ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Executa busca de colaboradores quando debouncedQuery muda
  useEffect(() => {
    const fetchUsers = async () => {
      const q = debouncedQuery.trim();
      if (!q || selectedUser) {
        setSearchResults([]);
        return;
      }

      const targetCompanyId = training?.company_id || user?.company_id || '';
      try {
        setSearching(true);
        const results = await sharingService.searchCompanyUsers(targetCompanyId, q);
        setSearchResults(results);
      } catch (err) {
        console.error('Erro ao buscar colaboradores:', err);
      } finally {
        setSearching(false);
      }
    };

    fetchUsers();
  }, [debouncedQuery, selectedUser, training, user]);

  // Seleciona um colaborador na lista de sugestões
  const handleSelectUser = (profile: Profile) => {
    setSelectedUser(profile);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Limpa o colaborador selecionado para buscar novamente
  const handleClearSelected = () => {
    setSelectedUser(null);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Concede ou atualiza acesso ao treinamento
  const handleInvite = async () => {
    const emailToShare = selectedUser ? selectedUser.email : searchQuery.trim();
    if (!emailToShare) {
      alert('Selecione ou informe um colaborador.');
      return;
    }

    try {
      setInviting(true);
      const companyId = training?.company_id || user?.company_id || '';
      const targetParam = selectedUser
        ? { id: selectedUser.id, name: selectedUser.name, email: selectedUser.email }
        : emailToShare;

      const { perm, error } = await sharingService.shareWithUser(
        id,
        targetParam,
        invitePermission,
        companyId
      );

      if (error || !perm) {
        alert(error || 'Erro ao compartilhar treinamento.');
      } else {
        // Atualiza a lista de permissões localmente sem recarregar tudo
        setPermissions((prev) => {
          const existingIdx = prev.findIndex((p) => p.user_id === perm.user_id);
          if (existingIdx !== -1) {
            const updated = [...prev];
            updated[existingIdx] = perm;
            return updated;
          }
          return [...prev, perm];
        });

        const targetName = perm.user?.name || perm.user?.email || 'Colaborador';
        handleClearSelected();
        alert(`Acesso concedido com sucesso para ${targetName}!`);
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao convidar usuário.');
    } finally {
      setInviting(false);
    }
  };

  // Remove o acesso de um usuário ao treinamento
  const handleRemove = async (perm: TrainingPermission) => {
    // Não permite remover o criador original do treinamento
    if (training && perm.user_id === training.created_by) {
      alert('Não é possível remover o criador original do treinamento.');
      return;
    }

    const doRemove = async () => {
      const { success, error } = await sharingService.removePermission(perm.id);
      if (success) {
        setPermissions((prev) => prev.filter((p) => p.id !== perm.id));
      } else {
        alert(error || 'Erro ao remover acesso.');
      }
    };

    if (typeof window !== 'undefined' && window.confirm) {
      if (window.confirm(`Remover acesso de ${perm.user?.name || perm.user?.email}?`)) {
        doRemove();
      }
    } else {
      doRemove();
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando compartilhamentos...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: topPadding, paddingBottom: bottomPadding },
      ]}
    >
      {/* Barra Superior */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.replace(`/training/${id}` as any)}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
          <Text style={styles.backBtnText}>Voltar ao Treinamento</Text>
        </TouchableOpacity>
      </View>

      {/* Cabeçalho */}
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderLeft}>
          <Ionicons name="share-social-outline" size={24} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pageTitle}>Compartilhar Treinamento</Text>
            <Text style={styles.pageSubtitle} numberOfLines={1}>{training?.title}</Text>
          </View>
        </View>
      </View>

      {/* Card: Conceder Acesso com Busca Inteligente */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Conceder Acesso</Text>
        <Text style={styles.sectionDesc}>
          Digite o nome ou e-mail de um colaborador da empresa para localizá-lo e conceder acesso.
        </Text>

        {/* Campo de Busca / Selecionado */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Colaborador</Text>

          {selectedUser ? (
            // Card do Colaborador Selecionado
            <View style={styles.selectedUserCard}>
              <View style={styles.userAvatar}>
                <Text style={styles.userAvatarText}>
                  {selectedUser.name ? selectedUser.name.substring(0, 2).toUpperCase() : 'CO'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedUserName}>{selectedUser.name}</Text>
                <Text style={styles.selectedUserEmail}>{selectedUser.email}</Text>
              </View>
              <TouchableOpacity
                style={styles.changeUserBtn}
                onPress={handleClearSelected}
                activeOpacity={0.7}
              >
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                <Text style={styles.changeUserBtnText}>Trocar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Input com delayOutput (busca automática)
            <View>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Digite o nome ou e-mail do colaborador..."
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
                {searching && (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
                )}
                {searchQuery.length > 0 && !searching && (
                  <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Lista de Sugestões de Colaboradores */}
              {searchResults.length > 0 && (
                <View style={styles.dropdownContainer}>
                  {searchResults.map((item) => {
                    const existingPerm = permissions.find((p) => p.user_id === item.id);
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.dropdownItem}
                        onPress={() => handleSelectUser(item)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.dropdownAvatar}>
                          <Text style={styles.dropdownAvatarText}>
                            {item.name ? item.name.substring(0, 2).toUpperCase() : 'CO'}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.dropdownItemName}>{item.name}</Text>
                          <Text style={styles.dropdownItemEmail}>{item.email}</Text>
                        </View>
                        {existingPerm && (
                          <View style={styles.alreadyHasAccessBadge}>
                            <Text style={styles.alreadyHasAccessText}>
                              {PERMISSION_LABELS[existingPerm.permission]?.label || 'Acesso Ativo'}
                            </Text>
                          </View>
                        )}
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Aviso se a busca não encontrou resultados */}
              {debouncedQuery.trim().length >= 2 && !searching && searchResults.length === 0 && (
                <View style={styles.noResultsBox}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
                  <Text style={styles.noResultsText}>
                    Nenhum colaborador encontrado com &quot;{debouncedQuery}&quot;.
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Nível de Acesso */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nível de Acesso</Text>
          <View style={styles.permButtons}>
            {(['viewer', 'editor', 'owner'] as PermissionLevel[]).map((level) => {
              const info = PERMISSION_LABELS[level];
              const isSelected = invitePermission === level;
              return (
                <TouchableOpacity
                  key={level}
                  style={[
                    styles.permBtn,
                    isSelected && { borderColor: info.color, backgroundColor: info.color + '15' },
                  ]}
                  onPress={() => setInvitePermission(level)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.permBtnText,
                      isSelected && { color: info.color, fontWeight: '700' },
                    ]}
                  >
                    {info.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Botão de Conceder Acesso */}
        <TouchableOpacity
          style={[
            styles.inviteBtn,
            (!selectedUser && !searchQuery.trim()) && styles.inviteBtnDisabled,
          ]}
          onPress={handleInvite}
          disabled={inviting || (!selectedUser && !searchQuery.trim())}
          activeOpacity={0.8}
        >
          {inviting ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <>
              <Ionicons name="person-add-outline" size={18} color={colors.textInverse} />
              <Text style={styles.inviteBtnText}>Conceder Acesso</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Explicação dos Níveis de Acesso */}
      <View style={[styles.card, { marginTop: 16 }]}>
        <Text style={styles.sectionTitle}>Entenda os Níveis de Acesso</Text>
        {(Object.keys(PERMISSION_LABELS) as PermissionLevel[]).map((level) => {
          const info = PERMISSION_LABELS[level];
          return (
            <View key={level} style={styles.permLevelRow}>
              <View style={[styles.permLevelDot, { backgroundColor: info.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.permLevelLabel}>{info.label}</Text>
                <Text style={styles.permLevelDesc}>{info.desc}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Lista de quem tem acesso */}
      <View style={[styles.card, { marginTop: 16 }]}>
        <Text style={styles.sectionTitle}>Quem Tem Acesso</Text>
        {permissions.length === 0 ? (
          <Text style={styles.emptyText}>Nenhum colaborador com acesso concedido ainda.</Text>
        ) : (
          <View style={styles.permList}>
            {permissions.map((perm) => {
              const info = PERMISSION_LABELS[perm.permission];
              return (
                <View key={perm.id} style={styles.permRow}>
                  <View style={styles.permRowLeft}>
                    <View style={[styles.permDot, { backgroundColor: info.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.permUserName}>
                        {perm.user?.name || 'Colaborador'}
                      </Text>
                      <Text style={styles.permUserEmail}>{perm.user?.email}</Text>
                    </View>
                  </View>

                  <View style={styles.permRowRight}>
                    <View style={[styles.permBadge, { backgroundColor: info.color + '20' }]}>
                      <Text style={[styles.permBadgeText, { color: info.color }]}>
                        {info.label.toUpperCase()}
                      </Text>
                    </View>

                    {perm.user_id === training?.created_by ? (
                      <View style={[styles.permBadge, { backgroundColor: colors.primary + '20' }]}>
                        <Text style={[styles.permBadgeText, { color: colors.primary }]}>CRIADOR</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.removeBtn}
                        onPress={() => handleRemove(perm)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
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
    maxWidth: 780,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: colors.textSecondary,
    fontSize: 13,
  },
  topBar: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  backBtnText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  pageHeader: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 16,
    marginBottom: 16,
  },
  pageHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  pageSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 6,
  },
  sectionDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 0,
  },
  dropdownContainer: {
    marginTop: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    maxHeight: 240,
    ...Platform.select({
      web: {
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      },
      default: {
        elevation: 3,
      },
    }),
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: 10,
  },
  dropdownAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownAvatarText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.primary,
  },
  dropdownItemName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  dropdownItemEmail: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  alreadyHasAccessBadge: {
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    marginRight: 4,
  },
  alreadyHasAccessText: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  noResultsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginTop: 4,
    backgroundColor: '#F9F9F9',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  noResultsText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  selectedUserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '10',
    borderWidth: 1,
    borderColor: colors.primary + '40',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textInverse,
  },
  selectedUserName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.text,
  },
  selectedUserEmail: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  changeUserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: colors.surface,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  changeUserBtnText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  permButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  permBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    backgroundColor: colors.surface,
  },
  permBtnText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  inviteBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 3,
    marginTop: 6,
  },
  inviteBtnDisabled: {
    opacity: 0.5,
  },
  inviteBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 14,
  },
  permLevelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  permLevelDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  permLevelLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.text,
  },
  permLevelDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 8,
  },
  permList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  permRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  permDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  permUserName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  permUserEmail: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  permRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  permBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
  },
  permBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  removeBtn: {
    padding: 2,
  },
});
