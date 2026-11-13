import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { adminService, AdminStats } from '@/services/admin.service';
import { categoriesService } from '@/services/categories.service';
import type { Category } from '@/types/database';

export function CategoriesMetricsTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catName, setCatName] = useState('');
  const [catColor, setCatColor] = useState(colors.badgeColors[0]);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsData, catsData] = await Promise.all([
        adminService.getStats(),
        categoriesService.getCategories(),
      ]);
      setStats(statsData);
      setCategories(catsData);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao carregar métricas e categorias.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadData();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const openCreateModal = () => {
    setEditingCat(null);
    setCatName('');
    setCatColor(colors.badgeColors[0]);
    setShowModal(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatColor(cat.color || colors.badgeColors[0]);
    setShowModal(true);
  };

  const handleSaveCategory = async () => {
    if (!catName.trim()) {
      alert('Informe o nome da categoria.');
      return;
    }

    try {
      setSaving(true);
      if (editingCat) {
        const updated = await categoriesService.updateCategory(editingCat.id, {
          name: catName.trim(),
          color: catColor,
        });
        setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        const created = await categoriesService.createCategory({
          name: catName.trim(),
          color: catColor,
        });
        setCategories((prev) => [...prev, created]);
      }
      setShowModal(false);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar categoria.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = (cat: Category) => {
    const doDelete = async () => {
      try {
        await categoriesService.deleteCategory(cat.id);
        setCategories((prev) => prev.filter((c) => c.id !== cat.id));
        await loadData();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Erro ao excluir categoria.');
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      if (window.confirm(`Deseja excluir a categoria "${cat.name}"?`)) {
        doDelete();
      }
    } else {
      Alert.alert('Excluir Categoria', `Deseja excluir "${cat.name}"?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 24 }} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Métricas da Instância</Text>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats?.totalUsers ?? 0}</Text>
          <Text style={styles.statLabel}>Usuários ({stats?.activeUsers ?? 0} ativos)</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats?.totalTrainings ?? 0}</Text>
          <Text style={styles.statLabel}>
            Treinamentos ({stats?.publishedTrainings ?? 0} publicados)
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats?.totalSteps ?? 0}</Text>
          <Text style={styles.statLabel}>Etapas Cadastradas</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats?.totalCategories ?? categories.length}</Text>
          <Text style={styles.statLabel}>Categorias ({stats?.activeApiKeys ?? 0} chaves API)</Text>
        </View>
      </View>

      <View style={styles.catHeader}>
        <Text style={styles.sectionTitle}>Categorias de Treinamento</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={openCreateModal}>
          <Ionicons name="add" size={16} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>Nova Categoria</Text>
        </TouchableOpacity>
      </View>

      {categories.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>Nenhuma categoria cadastrada.</Text>
        </View>
      ) : (
        <View style={styles.catList}>
          {categories.map((cat) => (
            <View key={cat.id} style={styles.catCard}>
              <View style={[styles.colorDot, { backgroundColor: cat.color || colors.primary }]} />
              <Text style={styles.catName}>{cat.name}</Text>
              <View style={styles.catActions}>
                <TouchableOpacity style={styles.iconBtn} onPress={() => openEditModal(cat)}>
                  <Ionicons name="create-outline" size={18} color={colors.primaryHover} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={() => handleDeleteCategory(cat)}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <Modal visible={showModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editingCat ? 'Editar Categoria' : 'Nova Categoria'}
            </Text>

            <Text style={styles.fieldLabel}>Nome *</Text>
            <TextInput
              style={styles.input}
              value={catName}
              onChangeText={setCatName}
              placeholder="Ex: Segurança do Trabalho"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.fieldLabel}>Cor do Crachá</Text>
            <View style={styles.paletteRow}>
              {colors.badgeColors.map((hex) => (
                <TouchableOpacity
                  key={hex}
                  style={[
                    styles.swatch,
                    { backgroundColor: hex },
                    catColor === hex && styles.swatchSelected,
                  ]}
                  onPress={() => setCatColor(hex)}
                />
              ))}
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowModal(false)}
                disabled={saving}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleSaveCategory}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Salvar</Text>
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
    gap: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flexGrow: 1,
    minWidth: 160,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 16,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 4,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  emptyBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  catList: {
    gap: 8,
  },
  catCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 12,
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  catName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  catActions: {
    flexDirection: 'row',
    gap: 6,
  },
  iconBtn: {
    padding: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surfaceSubtle,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: 6,
    padding: 20,
    gap: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surfaceSubtle,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginVertical: 4,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colors.text,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
});
