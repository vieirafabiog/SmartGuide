// ==============================================================================
// Tela: Gerenciamento (ManagementScreen)
// Antigo Painel Admin reorganizado em Abas dedicadas:
// 1. Colaboradores (com busca com delay/debounce, filtros, badges e criação)
// 2. Empresas SaaS (Super Admin)
// 3. Métricas e Categorias
// 4. API & Integrações (Geração de API Key e Documentação Swagger OpenAPI)
// Todos os formulários usam Modais Centrais sobrepostos (sem deslocamento de tela)
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
  Alert,
  Switch,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { adminService, CompanyDashboardStats, CompanyWithStats } from '../../services/admin.service';
import { categoriesService } from '../../services/categories.service';
import { Category, Profile, UserRole } from '../../types/database';

export default function ManagementScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const isCompanyAdmin = user?.role === 'company_admin' || isSuperAdmin;

  // Abas disponíveis: 'users' | 'companies' | 'metrics' | 'api'
  const [activeTab, setActiveTab] = useState<'users' | 'companies' | 'metrics' | 'api'>('users');

  // ---------- ESTADO: COLABORADORES (ABA 1) ----------
  const [myCompanyUsers, setMyCompanyUsers] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearchText, setUserSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'creator' | 'company_admin'>('all');

  // Debounce do campo de busca de colaboradores (350ms delay)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(userSearchText.trim().toLowerCase());
    }, 350);
    return () => clearTimeout(handler);
  }, [userSearchText]);

  // ---------- ESTADO: MODAL DE NOVO COLABORADOR ----------
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [targetCompanyId, setTargetCompanyId] = useState<string>('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('user');
  const [creatingUser, setCreatingUser] = useState(false);

  // ---------- ESTADO: MÉTRICAS E CATEGORIAS (ABA 2) ----------
  const [stats, setStats] = useState<CompanyDashboardStats | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCreateCatModal, setShowCreateCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState(colors.primary);
  const [creatingCat, setCreatingCat] = useState(false);

  // ---------- ESTADO: API & INTEGRAÇÕES (ABA 3) ----------
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [generatingApiKey, setGeneratingApiKey] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // ---------- ESTADO: EMPRESAS SAAS (SUPER ADMIN) COM PAGINAÇÃO ----------
  const [companies, setCompanies] = useState<CompanyWithStats[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [companiesPage, setCompaniesPage] = useState(1);
  const [companiesTotal, setCompaniesTotal] = useState(0);
  const [companiesTotalPages, setCompaniesTotalPages] = useState(1);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [newCompName, setNewCompName] = useState('');
  const [newCompSlug, setNewCompSlug] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);

  // Edição de empresa
  const [editingCompany, setEditingCompany] = useState<CompanyWithStats | null>(null);
  const [editCompName, setEditCompName] = useState('');
  const [editCompSlug, setEditCompSlug] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [loading, setLoading] = useState(false);

  // Carregamento sob demanda: Colaboradores da empresa
  const loadUsersData = async (compId: string) => {
    if (!compId) return;
    try {
      setLoadingUsers(true);
      const users = await adminService.getCompanyUsers(compId);
      setMyCompanyUsers(users);
    } catch (error) {
      console.error('Erro ao carregar colaboradores:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Carregamento sob demanda: Empresas paginadas (Super Admin)
  const loadCompanies = async (page: number = 1, search: string = companySearch) => {
    try {
      setLoadingCompanies(true);
      const result = await adminService.getCompaniesWithStats(page, 10, search);
      setCompanies(result.companies);
      setCompaniesTotal(result.total);
      setCompaniesPage(result.page);
      setCompaniesTotalPages(result.totalPages);
    } catch (error) {
      console.error('Erro ao carregar empresas com paginação:', error);
    } finally {
      setLoadingCompanies(false);
    }
  };

  // Carregamento sob demanda: Métricas e Categorias
  const loadMetricsData = async (compId?: string) => {
    try {
      const [statsData, categoriesData] = await Promise.all([
        adminService.getCompanyStats(compId),
        categoriesService.getCategories(compId),
      ]);
      setStats(statsData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('Erro ao carregar métricas:', error);
    }
  };

  // Carregamento sob demanda: Chave de API
  const loadApiData = async (compId: string) => {
    if (!compId) return;
    try {
      const currentApiKey = await adminService.getCompanyApiKey(compId);
      setApiKey(currentApiKey);
    } catch (error) {
      console.error('Erro ao carregar chave de API:', error);
    }
  };

  // Carrega apenas os dados da aba ativa sob demanda (Performance First)
  useEffect(() => {
    const compId = user?.company_id;
    if (activeTab === 'users' && compId) {
      loadUsersData(compId);
    } else if (activeTab === 'companies' && isSuperAdmin) {
      loadCompanies(1, companySearch);
    } else if (activeTab === 'metrics') {
      loadMetricsData(compId || undefined);
    } else if (activeTab === 'api' && compId) {
      loadApiData(compId);
    }
  }, [activeTab, user?.company_id, isSuperAdmin]);

  // Debounce na busca de empresas para não sobrecarregar com 1000 empresas
  useEffect(() => {
    if (activeTab === 'companies' && isSuperAdmin) {
      const timer = setTimeout(() => {
        loadCompanies(1, companySearch);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [companySearch]);

  // ---------- AÇÕES: COLABORADORES ----------

  // Abre modal de criação de colaborador
  const openCreateUserModal = (companyId?: string) => {
    const compId = companyId || user?.company_id || (companies[0]?.id ?? '');
    setTargetCompanyId(compId);
    setNewUserName('');
    setNewUserEmail('');
    setNewUserPassword('');
    setNewUserRole('user');
    setShowCreateUserModal(true);
  };

  // Cria colaborador
  const handleCreateUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()) {
      alert('Preencha nome, e-mail e senha do novo colaborador.');
      return;
    }
    if (newUserPassword.length < 6) {
      alert('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    try {
      setCreatingUser(true);
      const { profile, error } = await adminService.createCompanyUser(
        targetCompanyId,
        newUserName.trim(),
        newUserEmail.trim().toLowerCase(),
        newUserRole,
        newUserPassword
      );

      if (error || !profile) {
        alert(error || 'Erro ao criar colaborador.');
      } else {
        alert('Colaborador cadastrado com sucesso!');
        setShowCreateUserModal(false);
        setNewUserName('');
        setNewUserEmail('');
        setNewUserPassword('');
        // Atualiza a lista local de colaboradores
        setMyCompanyUsers((prev) => [profile, ...prev]);
        if (stats) {
          setStats({ ...stats, totalEmployees: stats.totalEmployees + 1 });
        }
      }
    } catch (err: any) {
      alert(err.message || 'Erro inesperado.');
    } finally {
      setCreatingUser(false);
    }
  };

  // Altera o papel do usuário (Colaborador / Criador / Administrador)
  const handleChangeUserRole = async (targetUser: Profile, newRole: UserRole) => {
    if (targetUser.id === user?.id) {
      alert('Você não pode alterar seu próprio papel de acesso.');
      return;
    }

    const { success, error } = await adminService.updateUserRole(targetUser.id, newRole);
    if (success) {
      setMyCompanyUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, role: newRole } : u))
      );
      const roleLabel =
        newRole === 'company_admin'
          ? 'Administrador'
          : newRole === 'creator'
          ? 'Criador de Treinamento'
          : 'Colaborador';
      alert(`Papel atualizado para ${roleLabel}!`);
    } else {
      alert(error || 'Erro ao alterar papel do colaborador.');
    }
  };

  // Excluir colaborador definitivamente
  const handleDeleteUser = (targetUser: Profile) => {
    if (targetUser.id === user?.id) {
      alert('Você não pode excluir sua própria conta.');
      return;
    }

    const confirmAction = async () => {
      const { success, error } = await adminService.deleteCompanyUser(targetUser.id);
      if (success) {
        setMyCompanyUsers((prev) => prev.filter((u) => u.id !== targetUser.id));
        if (stats) {
          setStats({ ...stats, totalEmployees: Math.max(0, stats.totalEmployees - 1) });
        }
        alert('Colaborador excluído com sucesso.');
      } else {
        alert(error || 'Erro ao excluir colaborador.');
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      if (window.confirm(`Deseja realmente remover o colaborador "${targetUser.name}"?`)) {
        confirmAction();
      }
    } else {
      Alert.alert(
        'Excluir Colaborador',
        `Deseja realmente remover o colaborador "${targetUser.name}"?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Excluir', style: 'destructive', onPress: confirmAction },
        ]
      );
    }
  };

  // ---------- AÇÕES: API KEY ----------

  const handleGenerateApiKey = async () => {
    const companyId = user?.company_id || (companies[0]?.id ?? '');
    if (!companyId) {
      alert('Empresa não identificada.');
      return;
    }

    const confirmAction = async () => {
      try {
        setGeneratingApiKey(true);
        const { apiKey: newKey, error } = await adminService.generateApiKey(companyId);
        if (error || !newKey) {
          alert(error || 'Erro ao gerar chave de API.');
        } else {
          setApiKey(newKey.key);
          setShowApiKey(true);
          alert('Nova Chave de API gerada com sucesso! Guarde-a em local seguro.');
        }
      } catch (err: any) {
        alert(err.message || 'Erro inesperado.');
      } finally {
        setGeneratingApiKey(false);
      }
    };

    if (apiKey) {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
        if (
          window.confirm(
            'ATENÇÃO: Gerar uma nova chave invalidará a chave atual imediatamente. Deseja continuar?'
          )
        ) {
          confirmAction();
        }
      } else {
        Alert.alert(
          'Rotacionar Chave de API',
          'ATENÇÃO: Gerar uma nova chave invalidará a chave anterior imediatamente. Deseja continuar?',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Gerar Nova Chave', style: 'destructive', onPress: confirmAction },
          ]
        );
      }
    } else {
      confirmAction();
    }
  };

  const handleCopyApiKey = () => {
    if (!apiKey) return;
    if (Platform.OS === 'web' && navigator?.clipboard) {
      navigator.clipboard.writeText(apiKey);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } else {
      alert(`Chave copiada: ${apiKey}`);
    }
  };

  // ---------- AÇÕES: CATEGORIAS ----------

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) {
      alert('Informe o nome da categoria.');
      return;
    }
    const companyId = user?.company_id || (companies[0]?.id ?? '');
    try {
      setCreatingCat(true);
      const { category, error } = await categoriesService.createCategory(
        companyId,
        newCatName.trim(),
        newCatColor
      );

      if (error || !category) {
        alert(error || 'Erro ao cadastrar categoria.');
      } else {
        setCategories((prev) => [...prev, category]);
        setNewCatName('');
        setShowCreateCatModal(false);
        alert('Categoria cadastrada com sucesso!');
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao cadastrar categoria.');
    } finally {
      setCreatingCat(false);
    }
  };

  const handleDeleteCategory = async (cat: Category) => {
    const confirmDelete = async () => {
      const { success, error } = await categoriesService.deleteCategory(cat.id);
      if (success) {
        setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      } else {
        alert(error || 'Erro ao excluir categoria.');
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      if (window.confirm(`Excluir a categoria "${cat.name}"?`)) {
        confirmDelete();
      }
    } else {
      Alert.alert('Excluir Categoria', `Excluir a categoria "${cat.name}"?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: confirmDelete },
      ]);
    }
  };

  // ---------- AÇÕES: EMPRESAS (SUPER ADMIN) ----------

  const handleCreateCompany = async () => {
    if (!newCompName.trim() || !newCompSlug.trim()) {
      alert('Preencha o nome e o identificador da empresa.');
      return;
    }
    try {
      setCreatingCompany(true);
      const { company, error } = await adminService.createCompany(
        newCompName.trim(),
        newCompSlug.trim().toLowerCase()
      );
      if (error || !company) {
        alert(error || 'Erro ao cadastrar empresa.');
      } else {
        alert('Empresa cadastrada com sucesso!');
        setShowCreateCompanyModal(false);
        setNewCompName('');
        setNewCompSlug('');
        loadCompanies(1, '');
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao cadastrar empresa.');
    } finally {
      setCreatingCompany(false);
    }
  };

  const handleToggleCompanyActive = async (comp: CompanyWithStats) => {
    const newStatus = !comp.is_active;
    const { success, error } = await adminService.toggleCompanyStatus(comp.id, newStatus);
    if (success) {
      setCompanies((prev) =>
        prev.map((c) => (c.id === comp.id ? { ...c, is_active: newStatus } : c))
      );
    } else {
      alert(error || 'Erro ao alterar status da empresa.');
    }
  };

  const handleSaveEditCompany = async () => {
    if (!editingCompany || !editCompName.trim() || !editCompSlug.trim()) {
      alert('Preencha todos os campos.');
      return;
    }
    try {
      setSavingEdit(true);
      const { success, error } = await adminService.updateCompany(editingCompany.id, {
        name: editCompName.trim(),
        slug: editCompSlug.trim().toLowerCase(),
      });
      if (success) {
        setCompanies((prev) =>
          prev.map((c) =>
            c.id === editingCompany.id
              ? { ...c, name: editCompName.trim(), slug: editCompSlug.trim().toLowerCase() }
              : c
          )
        );
        setEditingCompany(null);
        alert('Empresa atualizada com sucesso!');
      } else {
        alert(error || 'Erro ao atualizar empresa.');
      }
    } catch (err: any) {
      alert(err.message || 'Erro inesperado.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteCompany = async (comp: CompanyWithStats) => {
    const confirmDelete = async () => {
      const { success, error } = await adminService.deleteCompany(comp.id);
      if (success) {
        setCompanies((prev) => prev.filter((c) => c.id !== comp.id));
        setCompaniesTotal((prev) => Math.max(0, prev - 1));
        alert('Empresa excluída com sucesso.');
      } else {
        alert(error || 'Erro ao excluir empresa.');
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      if (
        window.confirm(
          `ATENÇÃO: Excluir "${comp.name}" removerá todos os dados vinculados permanentemente. Confirma?`
        )
      ) {
        confirmDelete();
      }
    } else {
      Alert.alert(
        'Excluir Empresa',
        `ATENÇÃO: Excluir "${comp.name}" removerá todos os dados vinculados permanentemente. Confirma?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Excluir', style: 'destructive', onPress: confirmDelete },
        ]
      );
    }
  };

  // Filtragem dos colaboradores na Aba 1
  const filteredUsers = myCompanyUsers.filter((u) => {
    const matchesSearch =
      !debouncedSearch ||
      u.name.toLowerCase().includes(debouncedSearch) ||
      u.email.toLowerCase().includes(debouncedSearch);

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;

    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando gerenciamento...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.contentContainer}>
        {/* Cabeçalho do Painel */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Gerenciamento</Text>
            <Text style={styles.subtitle}>
              {isSuperAdmin
                ? 'Administração de empresas, colaboradores, categorias e integrações.'
                : 'Gestão de colaboradores, criadores de treinamentos, categorias e API.'}
            </Text>
          </View>
        </View>

        {/* Barra de Abas Superiores */}
        <View style={styles.tabNavRow}>
          <TouchableOpacity
            style={[styles.tabNavBtn, activeTab === 'users' && styles.tabNavBtnActive]}
            onPress={() => setActiveTab('users')}
          >
            <Ionicons
              name="people"
              size={18}
              color={activeTab === 'users' ? colors.primaryHover : colors.textSecondary}
            />
            <Text style={[styles.tabNavBtnText, activeTab === 'users' && styles.tabNavBtnTextActive]}>
              Colaboradores
            </Text>
          </TouchableOpacity>

          {isSuperAdmin && (
            <TouchableOpacity
              style={[styles.tabNavBtn, activeTab === 'companies' && styles.tabNavBtnActive]}
              onPress={() => setActiveTab('companies')}
            >
              <Ionicons
                name="business"
                size={18}
                color={activeTab === 'companies' ? colors.primaryHover : colors.textSecondary}
              />
              <Text
                style={[
                  styles.tabNavBtnText,
                  activeTab === 'companies' && styles.tabNavBtnTextActive,
                ]}
              >
                Empresas
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.tabNavBtn, activeTab === 'metrics' && styles.tabNavBtnActive]}
            onPress={() => setActiveTab('metrics')}
          >
            <Ionicons
              name="pie-chart"
              size={18}
              color={activeTab === 'metrics' ? colors.primaryHover : colors.textSecondary}
            />
            <Text style={[styles.tabNavBtnText, activeTab === 'metrics' && styles.tabNavBtnTextActive]}>
              Métricas & Categorias
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabNavBtn, activeTab === 'api' && styles.tabNavBtnActive]}
            onPress={() => setActiveTab('api')}
          >
            <Ionicons
              name="code-slash"
              size={18}
              color={activeTab === 'api' ? colors.primaryHover : colors.textSecondary}
            />
            <Text style={[styles.tabNavBtnText, activeTab === 'api' && styles.tabNavBtnTextActive]}>
              API & Integração
            </Text>
          </TouchableOpacity>
        </View>

        {/* ==================================================================== */}
        {/* ABA 1: COLABORADORES                                                 */}
        {/* ==================================================================== */}
        {activeTab === 'users' && (
          <View style={styles.tabContent}>
            {/* Barra de Ações: Busca + Filtro por Papel + Botão Novo */}
            <View style={styles.actionsBar}>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color={colors.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Pesquisar por nome ou e-mail..."
                  placeholderTextColor={colors.textMuted}
                  value={userSearchText}
                  onChangeText={setUserSearchText}
                />
                {userSearchText.length > 0 && (
                  <TouchableOpacity onPress={() => setUserSearchText('')}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={styles.primaryActionBtn}
                onPress={() => openCreateUserModal()}
                activeOpacity={0.8}
              >
                <Ionicons name="person-add" size={16} color={colors.textInverse} />
                <Text style={styles.primaryActionBtnText}>Novo Colaborador</Text>
              </TouchableOpacity>
            </View>

            {/* Pílulas de Filtro de Papéis */}
            <View style={styles.filterPillsRow}>
              <TouchableOpacity
                style={[styles.filterPill, roleFilter === 'all' && styles.filterPillActive]}
                onPress={() => setRoleFilter('all')}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    roleFilter === 'all' && styles.filterPillTextActive,
                  ]}
                >
                  Todos
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterPill, roleFilter === 'company_admin' && styles.filterPillActive]}
                onPress={() => setRoleFilter('company_admin')}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    roleFilter === 'company_admin' && styles.filterPillTextActive,
                  ]}
                >
                  Administradores
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterPill, roleFilter === 'creator' && styles.filterPillActive]}
                onPress={() => setRoleFilter('creator')}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    roleFilter === 'creator' && styles.filterPillTextActive,
                  ]}
                >
                  Criadores
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterPill, roleFilter === 'user' && styles.filterPillActive]}
                onPress={() => setRoleFilter('user')}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    roleFilter === 'user' && styles.filterPillTextActive,
                  ]}
                >
                  Colaboradores
                </Text>
              </TouchableOpacity>
            </View>

            {/* Lista de Colaboradores */}
            {loadingUsers ? (
              <View style={styles.centerLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.centerLoadingText}>Carregando colaboradores...</Text>
              </View>
            ) : filteredUsers.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="people-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>Nenhum colaborador encontrado</Text>
                <Text style={styles.emptySubtitle}>
                  {userSearchText
                    ? 'Nenhum resultado corresponde à sua pesquisa.'
                    : 'Cadastre o primeiro colaborador para a empresa.'}
                </Text>
                <TouchableOpacity
                  style={[styles.primaryActionBtn, { marginTop: 12 }]}
                  onPress={() => openCreateUserModal()}
                >
                  <Text style={styles.primaryActionBtnText}>Cadastrar Colaborador</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.userListContainer}>
                {filteredUsers.map((colab) => {
                  const isCurrent = colab.id === user?.id;
                  return (
                    <View key={colab.id} style={styles.userCard}>
                      <View style={styles.userCardLeft}>
                        {/* Avatar Inicial */}
                        <View style={styles.userAvatar}>
                          <Text style={styles.userAvatarText}>
                            {colab.name ? colab.name.charAt(0).toUpperCase() : 'U'}
                          </Text>
                        </View>

                        <View style={styles.userInfoCol}>
                          <View style={styles.userNameRow}>
                            <Text style={styles.userName}>{colab.name}</Text>
                            {isCurrent && <Text style={styles.currentBadge}>(Você)</Text>}
                          </View>
                          <Text style={styles.userEmail}>{colab.email}</Text>
                        </View>
                      </View>

                      {/* Lado Direito: Badge do Papel + Seletor de Permissão + Botão Excluir */}
                      <View style={styles.userCardRight}>
                        {/* Badge do Papel Atual */}
                        <View
                          style={[
                            styles.roleBadge,
                            colab.role === 'company_admin'
                              ? styles.roleBadgeAdmin
                              : colab.role === 'creator'
                              ? styles.roleBadgeCreator
                              : styles.roleBadgeUser,
                          ]}
                        >
                          <Text
                            style={[
                              styles.roleBadgeText,
                              colab.role === 'company_admin'
                                ? styles.roleBadgeTextAdmin
                                : colab.role === 'creator'
                                ? styles.roleBadgeTextCreator
                                : styles.roleBadgeTextUser,
                            ]}
                          >
                            {colab.role === 'company_admin'
                              ? 'ADMINISTRADOR'
                              : colab.role === 'creator'
                              ? 'CRIADOR'
                              : 'COLABORADOR'}
                          </Text>
                        </View>

                        {/* Botões de Alteração Rápida de Papel */}
                        {!isCurrent && (
                          <View style={styles.roleActionButtons}>
                            {colab.role !== 'user' && (
                              <TouchableOpacity
                                style={styles.roleActionBtn}
                                onPress={() => handleChangeUserRole(colab, 'user')}
                              >
                                <Text style={styles.roleActionBtnText}>Tornar Colaborador</Text>
                              </TouchableOpacity>
                            )}

                            {colab.role !== 'creator' && (
                              <TouchableOpacity
                                style={[styles.roleActionBtn, styles.roleActionBtnCreator]}
                                onPress={() => handleChangeUserRole(colab, 'creator')}
                              >
                                <Ionicons name="sparkles" size={12} color="#4F46E5" />
                                <Text style={styles.roleActionBtnCreatorText}>Tornar Criador</Text>
                              </TouchableOpacity>
                            )}

                            {colab.role !== 'company_admin' && (
                              <TouchableOpacity
                                style={[styles.roleActionBtn, styles.roleActionBtnAdmin]}
                                onPress={() => handleChangeUserRole(colab, 'company_admin')}
                              >
                                <Ionicons name="shield" size={12} color="#DC2626" />
                                <Text style={styles.roleActionBtnAdminText}>Tornar Admin</Text>
                              </TouchableOpacity>
                            )}

                            {/* Excluir Colaborador */}
                            <TouchableOpacity
                              style={styles.deleteUserBtn}
                              onPress={() => handleDeleteUser(colab)}
                            >
                              <Ionicons name="trash-outline" size={16} color={colors.danger} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ==================================================================== */}
        {/* ABA 2: EMPRESAS SAAS (SUPER ADMIN)                                    */}
        {/* ==================================================================== */}
        {isSuperAdmin && activeTab === 'companies' && (
          <View style={styles.tabContent}>
            <View style={styles.actionsBar}>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color={colors.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Pesquisar empresas cadastradas..."
                  placeholderTextColor={colors.textMuted}
                  value={companySearch}
                  onChangeText={setCompanySearch}
                />
              </View>

              <TouchableOpacity
                style={styles.primaryActionBtn}
                onPress={() => setShowCreateCompanyModal(true)}
              >
                <Ionicons name="add-circle" size={16} color={colors.textInverse} />
                <Text style={styles.primaryActionBtnText}>Nova Empresa</Text>
              </TouchableOpacity>
            </View>

            {loadingCompanies ? (
              <View style={styles.centerLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.centerLoadingText}>Carregando empresas...</Text>
              </View>
            ) : companies.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="business-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>Nenhuma empresa encontrada</Text>
                <Text style={styles.emptySubtitle}>
                  {companySearch
                    ? 'Nenhum resultado corresponde à sua pesquisa.'
                    : 'Cadastre a primeira empresa no sistema.'}
                </Text>
              </View>
            ) : (
              <View style={styles.companyGrid}>
                {companies.map((comp) => (
                  <View key={comp.id} style={styles.companyCard}>
                    <View style={styles.companyCardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.compCardName}>{comp.name}</Text>
                        <Text style={styles.compCardSlug}>{comp.slug}</Text>
                      </View>
                      <Switch
                        value={comp.is_active}
                        onValueChange={() => handleToggleCompanyActive(comp)}
                        trackColor={{ false: colors.borderLight, true: colors.primary }}
                        thumbColor="#FFF"
                      />
                    </View>

                    <View style={styles.compStatsRow}>
                      <View style={styles.compStatItem}>
                        <Text style={styles.compStatNum}>{comp.trainings_count}</Text>
                        <Text style={styles.compStatLabel}>Treinamentos</Text>
                      </View>
                      <View style={styles.compStatItem}>
                        <Text style={styles.compStatNum}>{comp.employees_count}</Text>
                        <Text style={styles.compStatLabel}>Colaboradores</Text>
                      </View>
                    </View>

                    <View style={styles.compCardActions}>
                      <TouchableOpacity
                        style={styles.compEditBtn}
                        onPress={() => {
                          setEditingCompany(comp);
                          setEditCompName(comp.name);
                          setEditCompSlug(comp.slug);
                        }}
                      >
                        <Ionicons name="pencil" size={14} color={colors.text} />
                        <Text style={styles.compEditBtnText}>Editar</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.compUserBtn}
                        onPress={() => openCreateUserModal(comp.id)}
                      >
                        <Ionicons name="person-add-outline" size={14} color={colors.primaryHover} />
                        <Text style={styles.compUserBtnText}>+ Colaborador</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.compDeleteBtn}
                        onPress={() => handleDeleteCompany(comp)}
                      >
                        <Ionicons name="trash-outline" size={14} color={colors.danger} />
                        <Text style={styles.compDeleteBtnText}>Excluir</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Controles de Paginação (Sob Demanda) */}
            {companiesTotalPages > 1 && (
              <View style={styles.paginationRow}>
                <TouchableOpacity
                  style={[styles.pageBtn, companiesPage <= 1 && styles.pageBtnDisabled]}
                  disabled={companiesPage <= 1 || loadingCompanies}
                  onPress={() => loadCompanies(companiesPage - 1, companySearch)}
                >
                  <Ionicons
                    name="chevron-back"
                    size={16}
                    color={companiesPage <= 1 ? colors.textMuted : colors.text}
                  />
                  <Text style={[styles.pageBtnText, companiesPage <= 1 && styles.pageBtnTextDisabled]}>
                    Anterior
                  </Text>
                </TouchableOpacity>

                <Text style={styles.pageInfoText}>
                  Página {companiesPage} de {companiesTotalPages} ({companiesTotal} empresas)
                </Text>

                <TouchableOpacity
                  style={[
                    styles.pageBtn,
                    companiesPage >= companiesTotalPages && styles.pageBtnDisabled,
                  ]}
                  disabled={companiesPage >= companiesTotalPages || loadingCompanies}
                  onPress={() => loadCompanies(companiesPage + 1, companySearch)}
                >
                  <Text
                    style={[
                      styles.pageBtnText,
                      companiesPage >= companiesTotalPages && styles.pageBtnTextDisabled,
                    ]}
                  >
                    Próxima
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={companiesPage >= companiesTotalPages ? colors.textMuted : colors.text}
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ==================================================================== */}
        {/* ABA 3: MÉTRICAS & CATEGORIAS                                         */}
        {/* ==================================================================== */}
        {activeTab === 'metrics' && (
          <View style={styles.tabContent}>
            {/* Dashboard KPIs */}
            {stats && (
              <View style={styles.kpiGrid}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiNumber}>{stats.totalTrainings}</Text>
                  <Text style={styles.kpiLabel}>Total de Treinamentos</Text>
                  <Text style={styles.kpiSub}>
                    {stats.publishedTrainings} publicados · {stats.draftTrainings} rascunhos
                  </Text>
                </View>

                <View style={styles.kpiCard}>
                  <Text style={styles.kpiNumber}>{stats.totalEmployees}</Text>
                  <Text style={styles.kpiLabel}>Colaboradores</Text>
                  <Text style={styles.kpiSub}>Cadastrados na empresa</Text>
                </View>

                <View style={styles.kpiCard}>
                  <Text style={styles.kpiNumber}>{categories.length}</Text>
                  <Text style={styles.kpiLabel}>Categorias</Text>
                  <Text style={styles.kpiSub}>Classificações ativas</Text>
                </View>
              </View>
            )}

            {/* Gestão de Categorias */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>Categorias de Treinamentos</Text>
                  <Text style={styles.sectionSubtitle}>
                    Organize os treinamentos por áreas ou temas
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.primaryActionBtn}
                  onPress={() => setShowCreateCatModal(true)}
                >
                  <Ionicons name="add" size={16} color={colors.textInverse} />
                  <Text style={styles.primaryActionBtnText}>Nova Categoria</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.catGrid}>
                {categories.map((cat) => (
                  <View key={cat.id} style={styles.catCard}>
                    <View style={styles.catCardLeft}>
                      <View style={[styles.catDot, { backgroundColor: cat.color || colors.primary }]} />
                      <Text style={styles.catName}>{cat.name}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteCategory(cat)}
                      style={styles.catDeleteBtn}
                    >
                      <Ionicons name="trash-outline" size={14} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* ==================================================================== */}
        {/* ABA 4: API & INTEGRAÇÕES                                             */}
        {/* ==================================================================== */}
        {activeTab === 'api' && (
          <View style={styles.tabContent}>
            {/* Card 1: Chave de API Corporativa */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Chave de API (x-api-key)</Text>
                  <Text style={styles.sectionSubtitle}>
                    Utilize esta chave para integrar sistemas externos (ERP, Folha de Pagamento,
                    automações) à plataforma SmartGuide.
                  </Text>
                </View>
              </View>

              <View style={styles.apiKeyContainer}>
                <View style={styles.apiKeyBox}>
                  <Ionicons name="key-outline" size={18} color={colors.primaryHover} />
                  <Text style={styles.apiKeyValue}>
                    {apiKey
                      ? showApiKey
                        ? apiKey
                        : `${apiKey.substring(0, 10)}${'•'.repeat(26)}`
                      : 'Nenhuma chave de API gerada para esta empresa.'}
                  </Text>
                  {apiKey && (
                    <TouchableOpacity
                      style={styles.apiKeyToggleBtn}
                      onPress={() => setShowApiKey(!showApiKey)}
                    >
                      <Ionicons
                        name={showApiKey ? 'eye-off-outline' : 'eye-outline'}
                        size={18}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.apiKeyActions}>
                  {apiKey && (
                    <TouchableOpacity style={styles.copyBtn} onPress={handleCopyApiKey}>
                      <Ionicons
                        name={copyFeedback ? 'checkmark' : 'copy-outline'}
                        size={16}
                        color={colors.text}
                      />
                      <Text style={styles.copyBtnText}>
                        {copyFeedback ? 'Copiado!' : 'Copiar Chave'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.primaryActionBtn, generatingApiKey && { opacity: 0.6 }]}
                    onPress={handleGenerateApiKey}
                    disabled={generatingApiKey}
                  >
                    {generatingApiKey ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Ionicons name="refresh" size={16} color="#FFF" />
                        <Text style={styles.primaryActionBtnText}>
                          {apiKey ? 'Rotacionar Chave' : 'Gerar Chave de API'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.apiKeyWarning}>
                Envie a chave no cabeçalho HTTP:{' '}
                <Text style={styles.codeText}>
                  x-api-key: {apiKey ? 'sua_chave' : 'sg_live_...'}
                </Text>
              </Text>
            </View>

            {/* Card 2: Documentação Interativa Swagger */}
            <View style={styles.swaggerBanner}>
              <View style={styles.swaggerBannerContent}>
                <View style={styles.swaggerLogoBadge}>
                  <Ionicons name="book" size={24} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.swaggerBannerTitle}>Documentação Swagger (OpenAPI 3.0)</Text>
                  <Text style={styles.swaggerBannerSubtitle}>
                    Acesse a especificação completa da API RESTful com exemplos de requisição, schemas de dados e botão Try-It-Out interativo.
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.swaggerOpenBtn}
                onPress={() => {
                  if (Platform.OS === 'web') {
                    window.open('/swagger-ui.html', '_blank');
                  } else {
                    router.push('/swagger');
                  }
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.swaggerOpenBtnText}>Abrir Especificação Swagger</Text>
                <Ionicons name="open-outline" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>

            {/* Card 3: Resumo dos Endpoints REST */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Endpoints REST Disponíveis</Text>
              <Text style={styles.sectionSubtitle}>Rotas suportadas para integração direta</Text>

              <View style={styles.endpointList}>
                <View style={styles.endpointRow}>
                  <View style={[styles.methodBadge, styles.methodPost]}>
                    <Text style={styles.methodBadgeText}>POST</Text>
                  </View>
                  <Text style={styles.endpointPath}>/api/users</Text>
                  <Text style={styles.endpointDesc}>
                    Cria novo colaborador (com papéis: user, creator, company_admin)
                  </Text>
                </View>

                <View style={styles.endpointRow}>
                  <View style={[styles.methodBadge, styles.methodDelete]}>
                    <Text style={styles.methodBadgeText}>DELETE</Text>
                  </View>
                  <Text style={styles.endpointPath}>/api/users/{'{id}'}</Text>
                  <Text style={styles.endpointDesc}>Exclui colaborador definitivamente</Text>
                </View>

                <View style={styles.endpointRow}>
                  <View style={[styles.methodBadge, styles.methodGet]}>
                    <Text style={styles.methodBadgeText}>GET</Text>
                  </View>
                  <Text style={styles.endpointPath}>/api/users</Text>
                  <Text style={styles.endpointDesc}>Lista todos os colaboradores da empresa</Text>
                </View>

                <View style={styles.endpointRow}>
                  <View style={[styles.methodBadge, styles.methodGet]}>
                    <Text style={styles.methodBadgeText}>GET</Text>
                  </View>
                  <Text style={styles.endpointPath}>/api/trainings</Text>
                  <Text style={styles.endpointDesc}>Lista treinamentos disponíveis na empresa</Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ==================================================================== */}
      {/* MODAL: NOVO COLABORADOR (CENTRALIZADO)                                */}
      {/* ==================================================================== */}
      <Modal
        visible={showCreateUserModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateUserModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Novo Colaborador</Text>
                <Text style={styles.modalSubtitle}>
                  Cadastre um usuário e defina se ele poderá criar treinamentos
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowCreateUserModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nome Completo *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="Ex: Amanda Albuquerque"
                  placeholderTextColor={colors.textMuted}
                  value={newUserName}
                  onChangeText={setNewUserName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>E-mail Corporativo *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="amanda@empresa.com.br"
                  placeholderTextColor={colors.textMuted}
                  value={newUserEmail}
                  onChangeText={setNewUserEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Senha de Acesso *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="Mínimo 6 caracteres"
                  placeholderTextColor={colors.textMuted}
                  value={newUserPassword}
                  onChangeText={setNewUserPassword}
                  secureTextEntry
                />
              </View>

              {/* Seletor de Perfil / Papel */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nível de Acesso (Papel)</Text>
                <View style={styles.rolePickerRow}>
                  <TouchableOpacity
                    style={[
                      styles.rolePickerBtn,
                      newUserRole === 'user' && styles.rolePickerBtnActive,
                    ]}
                    onPress={() => setNewUserRole('user')}
                  >
                    <Ionicons
                      name="person"
                      size={16}
                      color={newUserRole === 'user' ? '#FFF' : colors.text}
                    />
                    <Text
                      style={[
                        styles.rolePickerBtnText,
                        newUserRole === 'user' && styles.rolePickerBtnTextActive,
                      ]}
                    >
                      Colaborador
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.rolePickerBtn,
                      newUserRole === 'creator' && styles.rolePickerBtnCreatorActive,
                    ]}
                    onPress={() => setNewUserRole('creator')}
                  >
                    <Ionicons
                      name="sparkles"
                      size={16}
                      color={newUserRole === 'creator' ? '#FFF' : '#4F46E5'}
                    />
                    <Text
                      style={[
                        styles.rolePickerBtnText,
                        newUserRole === 'creator' && styles.rolePickerBtnTextActive,
                      ]}
                    >
                      Criador
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.rolePickerBtn,
                      newUserRole === 'company_admin' && styles.rolePickerBtnAdminActive,
                    ]}
                    onPress={() => setNewUserRole('company_admin')}
                  >
                    <Ionicons
                      name="shield"
                      size={16}
                      color={newUserRole === 'company_admin' ? '#FFF' : '#DC2626'}
                    />
                    <Text
                      style={[
                        styles.rolePickerBtnText,
                        newUserRole === 'company_admin' && styles.rolePickerBtnTextActive,
                      ]}
                    >
                      Admin
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.rolePickerHint}>
                  {newUserRole === 'creator'
                    ? '✓ O Criador poderá criar e editar treinamentos na empresa.'
                    : newUserRole === 'company_admin'
                    ? '✓ O Administrador tem acesso total a colaboradores, categorias e API.'
                    : '✓ O Colaborador tem acesso como aluno aos treinamentos atribuídos.'}
                </Text>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowCreateUserModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleCreateUser}
                disabled={creatingUser}
              >
                {creatingUser ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Cadastrar Colaborador</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* MODAL: NOVA CATEGORIA (CENTRALIZADO)                                  */}
      {/* ==================================================================== */}
      <Modal
        visible={showCreateCatModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateCatModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nova Categoria</Text>
              <TouchableOpacity
                onPress={() => setShowCreateCatModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nome da Categoria *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="Ex: Segurança do Trabalho, Onboarding..."
                  placeholderTextColor={colors.textMuted}
                  value={newCatName}
                  onChangeText={setNewCatName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Cor de Identificação</Text>
                <View style={styles.colorPickerRow}>
                  {['#0078D4', '#107C41', '#D83B01', '#8764B8', '#004E8C', '#E3008C'].map(
                    (cor) => (
                      <TouchableOpacity
                        key={cor}
                        style={[
                          styles.colorOption,
                          { backgroundColor: cor },
                          newCatColor === cor && styles.colorOptionSelected,
                        ]}
                        onPress={() => setNewCatColor(cor)}
                      />
                    )
                  )}
                </View>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowCreateCatModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleCreateCategory}
                disabled={creatingCat}
              >
                {creatingCat ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Cadastrar Categoria</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* MODAL: NOVA EMPRESA (SUPER ADMIN)                                    */}
      {/* ==================================================================== */}
      <Modal
        visible={showCreateCompanyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateCompanyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Cadastrar Nova Empresa</Text>
              <TouchableOpacity
                onPress={() => setShowCreateCompanyModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nome da Empresa *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="Ex: Grupo Votorantim"
                  placeholderTextColor={colors.textMuted}
                  value={newCompName}
                  onChangeText={(val) => {
                    setNewCompName(val);
                    if (!newCompSlug) {
                      setNewCompSlug(val.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                    }
                  }}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Identificador Único (Slug) *</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="Ex: grupo-votorantim"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  value={newCompSlug}
                  onChangeText={setNewCompSlug}
                />
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowCreateCompanyModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleCreateCompany}
                disabled={creatingCompany}
              >
                {creatingCompany ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Cadastrar Empresa</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================================================================== */}
      {/* MODAL: EDITAR EMPRESA (SUPER ADMIN)                                  */}
      {/* ==================================================================== */}
      <Modal
        visible={!!editingCompany}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingCompany(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Editar Empresa</Text>
              <TouchableOpacity
                onPress={() => setEditingCompany(null)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nome da Empresa *</Text>
                <TextInput
                  style={styles.inputField}
                  value={editCompName}
                  onChangeText={setEditCompName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Identificador Único (Slug) *</Text>
                <TextInput
                  style={styles.inputField}
                  value={editCompSlug}
                  onChangeText={setEditCompSlug}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditingCompany(null)}
              >
                <Text style={styles.modalCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleSaveEditCompany}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Salvar Alterações</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollArea: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 90,
    maxWidth: 1050,
    width: '100%',
    alignSelf: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 12,
    color: colors.textSecondary,
    fontSize: 13,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },

  // Barra de Navegação por Abas
  tabNavRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    marginBottom: 20,
    flexWrap: 'wrap',
    gap: 8,
  },
  tabNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabNavBtnActive: {
    borderBottomColor: colors.primary,
  },
  tabNavBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabNavBtnTextActive: {
    color: colors.primaryHover,
  },
  tabContent: {
    paddingBottom: 40,
  },

  // Barra de Ações (Busca + Botão Principal)
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  searchBox: {
    flex: 1,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    outlineWidth: 0,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 6,
  },
  primaryActionBtnText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: 'bold',
  },

  // Filtros em Pílula
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  filterPillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterPillTextActive: {
    color: colors.primaryHover,
  },

  roleHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
  },
  roleHintText: {
    fontSize: 12,
    color: '#1E3A8A',
    flex: 1,
    lineHeight: 18,
  },

  // Cards de Colaboradores
  userListContainer: {
    gap: 10,
  },
  userCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 6,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  userCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 260,
  },
  userAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
  },
  userInfoCol: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  currentBadge: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.primaryHover,
  },
  userEmail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  userCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  roleBadgeAdmin: {
    backgroundColor: '#FEE2E2',
  },
  roleBadgeTextAdmin: {
    color: '#DC2626',
  },
  roleBadgeCreator: {
    backgroundColor: '#EEF2FF',
  },
  roleBadgeTextCreator: {
    color: '#4F46E5',
  },
  roleBadgeUser: {
    backgroundColor: '#F1F5F9',
  },
  roleBadgeTextUser: {
    color: '#475569',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  roleActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFF',
  },
  roleActionBtnText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  roleActionBtnCreator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderColor: '#C7D2FE',
    backgroundColor: '#EEF2FF',
  },
  roleActionBtnCreatorText: {
    fontSize: 11,
    color: '#4F46E5',
    fontWeight: '700',
  },
  roleActionBtnAdmin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  roleActionBtnAdminText: {
    fontSize: 11,
    color: '#DC2626',
    fontWeight: '700',
  },
  deleteUserBtn: {
    padding: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: '#FFF',
  },

  // Seções Gerais
  sectionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 6,
    padding: 20,
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // KPI Grid
  kpiGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  kpiCard: {
    flex: 1,
    minWidth: 200,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 6,
    padding: 16,
  },
  kpiNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
  },
  kpiLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 4,
  },
  kpiSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Categorias Grid
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  catCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: '#FAFAFA',
    minWidth: 180,
    gap: 10,
  },
  catCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  catDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  catName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  catDeleteBtn: {
    padding: 2,
  },

  // API Key Section
  apiKeyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  apiKeyBox: {
    flex: 1,
    minWidth: 280,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 44,
  },
  apiKeyValue: {
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    fontSize: 13,
    color: colors.text,
    flex: 1,
  },
  apiKeyToggleBtn: {
    padding: 4,
  },
  apiKeyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFF',
  },
  copyBtnText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  apiKeyWarning: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  codeText: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    backgroundColor: '#F1F5F9',
    color: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: '600',
  },

  // Banner Swagger
  swaggerBanner: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 20,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 16,
  },
  swaggerBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
    minWidth: 280,
  },
  swaggerLogoBadge: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swaggerBannerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
  },
  swaggerBannerSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
    maxWidth: 500,
  },
  swaggerOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 6,
  },
  swaggerOpenBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },

  // Endpoint List
  endpointList: {
    marginTop: 12,
    gap: 10,
  },
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    flexWrap: 'wrap',
  },
  methodBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    minWidth: 60,
    alignItems: 'center',
  },
  methodPost: {
    backgroundColor: '#10B981',
  },
  methodDelete: {
    backgroundColor: '#EF4444',
  },
  methodGet: {
    backgroundColor: '#3B82F6',
  },
  methodBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  endpointPath: {
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    minWidth: 140,
  },
  endpointDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },

  // Grid Empresas (Super Admin)
  companyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  companyCard: {
    flex: 1,
    minWidth: 280,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 6,
    padding: 16,
  },
  companyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  compCardName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
  },
  compCardSlug: {
    fontSize: 12,
    color: colors.textSecondary,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  compStatsRow: {
    flexDirection: 'row',
    gap: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: 12,
  },
  compStatItem: {
    flex: 1,
  },
  compStatNum: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  compStatLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  compCardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  compEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  compEditBtnText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  compUserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: colors.primaryLight,
  },
  compUserBtnText: {
    fontSize: 12,
    color: colors.primaryHover,
    fontWeight: '600',
  },
  compDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  compDeleteBtnText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '600',
  },

  // Estados Vazios e Centrais
  centerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  centerLoadingText: {
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: 12,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 6,
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 320,
  },

  // ==========================================================================
  // ESTILOS DE MODAIS CENTRAIS SOBREPOSTOS
  // ==========================================================================
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalBody: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  inputField: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 13,
    color: colors.text,
    outlineWidth: 0,
  },
  rolePickerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  rolePickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FAFAFA',
  },
  rolePickerBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  rolePickerBtnCreatorActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  rolePickerBtnAdminActive: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  rolePickerBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  rolePickerBtnTextActive: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  rolePickerHint: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
    marginTop: 2,
  },
  colorPickerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  colorOption: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  colorOptionSelected: {
    borderWidth: 3,
    borderColor: '#FFF',
    boxShadow: '0 0 0 2px #0078D4',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: '#F8FAFC',
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFF',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  modalSubmitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: colors.primary,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFF',
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 20,
    marginBottom: 10,
    paddingVertical: 12,
  },
  pageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pageBtnDisabled: {
    opacity: 0.4,
    borderColor: colors.borderLight,
  },
  pageBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  pageBtnTextDisabled: {
    color: colors.textMuted,
  },
  pageInfoText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
});
