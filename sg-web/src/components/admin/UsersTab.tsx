import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/constants/colors';
import { translateApiError } from '@/i18n/errorMapper';
import { adminService } from '@/services/admin.service';
import type { Profile, SupportedLocale, UserRole } from '@/types/database';

interface UsersTabProps {
  currentUserId?: string;
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin: colors.primary,
  creator: colors.info,
  user: colors.success,
};

const LOCALE_OPTIONS: SupportedLocale[] = ['pt-BR', 'en', 'es'];

export function UsersTab({ currentUserId }: UsersTabProps) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [newLocale, setNewLocale] = useState<SupportedLocale>('pt-BR');
  const [creating, setCreating] = useState(false);

  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('user');
  const [editLocale, setEditLocale] = useState<SupportedLocale>('pt-BR');
  const [editActive, setEditActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adminService.listUsers({
        page: 1,
        pageSize: 50,
        search: debouncedSearch || undefined,
        role: roleFilter === 'all' ? undefined : roleFilter,
      });
      setUsers(res.users);
    } catch (err: unknown) {
      alert(translateApiError(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, roleFilter]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadUsers();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadUsers]);

  const handleCreateUser = async () => {
    if (!newName.trim() || !newEmail.trim() || newPassword.length < 8) {
      alert(t('admin.users.requiredFields'));
      return;
    }

    try {
      setCreating(true);
      await adminService.createUser({
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        role: newRole,
        preferredLocale: newLocale,
      });
      setShowCreateModal(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      setNewLocale('pt-BR');
      await loadUsers();
      alert(t('admin.users.createdSuccess'));
    } catch (err: unknown) {
      alert(translateApiError(err));
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (target: Profile) => {
    setEditingUser(target);
    setEditName(target.name);
    setEditRole(target.role);
    setEditLocale(target.preferred_locale ?? 'pt-BR');
    setEditActive(target.is_active);
  };

  const handleSaveEdit = async () => {
    if (!editingUser || !editName.trim()) {
      alert(t('common.requiredField'));
      return;
    }

    try {
      setSavingEdit(true);
      const updated = await adminService.updateUser(editingUser.id, {
        name: editName.trim(),
        role: editRole,
        preferredLocale: editLocale,
        isActive: editActive,
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditingUser(null);
    } catch (err: unknown) {
      alert(translateApiError(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteUser = (target: Profile) => {
    if (target.id === currentUserId) {
      alert(t('admin.users.deleteSelfError'));
      return;
    }

    const doDelete = async () => {
      try {
        await adminService.deleteUser(target.id);
        setUsers((prev) => prev.filter((u) => u.id !== target.id));
      } catch (err: unknown) {
        alert(translateApiError(err));
      }
    };

    const confirmMsg = t('admin.users.deleteConfirm', { name: target.name, email: target.email });
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      if (window.confirm(confirmMsg)) {
        doDelete();
      }
    } else {
      Alert.alert(t('common.delete'), confirmMsg, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('admin.users.title')}</Text>
          <Text style={styles.subtitle}>{t('admin.users.subtitle')}</Text>
        </View>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowCreateModal(true)}>
          <Ionicons name="person-add-outline" size={16} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>{t('admin.users.newUser')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('admin.users.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filterRow}>
        {(['all', 'admin', 'creator', 'user'] as const).map((filter) => {
          const active = roleFilter === filter;
          const label = filter === 'all' ? t('admin.users.filterAll') : t(`roles.${filter}`);
          return (
            <TouchableOpacity
              key={filter}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setRoleFilter(filter)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 24 }} />
      ) : users.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>{t('admin.users.empty')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {users.map((item) => {
            const roleColor = ROLE_COLORS[item.role] || colors.textSecondary;
            return (
              <View key={item.id} style={styles.userCard}>
                <View style={{ flex: 1 }}>
                  <View style={styles.userNameRow}>
                    <Text style={styles.userName}>{item.name}</Text>
                    {!item.is_active && (
                      <View style={styles.inactiveBadge}>
                        <Text style={styles.inactiveBadgeText}>{t('admin.users.inactiveBadge')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.userEmail}>{item.email}</Text>
                </View>

                <View style={[styles.roleBadge, { backgroundColor: `${roleColor}20` }]}>
                  <Text style={[styles.roleBadgeText, { color: roleColor }]}>
                    {t(`roles.${item.role}`)}
                  </Text>
                </View>

                <View style={styles.cardActions}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => openEditModal(item)}>
                    <Ionicons name="create-outline" size={18} color={colors.primaryHover} />
                  </TouchableOpacity>
                  {item.id !== currentUserId && (
                    <TouchableOpacity style={styles.iconBtn} onPress={() => handleDeleteUser(item)}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Modal: Criar Usuário */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('admin.users.createModalTitle')}</Text>

            <Text style={styles.fieldLabel}>{t('admin.users.fullName')}</Text>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('auth.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.fieldLabel}>{t('admin.users.email')}</Text>
            <TextInput
              style={styles.input}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder={t('auth.emailPlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.fieldLabel}>{t('admin.users.initialPassword')}</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />

            <Text style={styles.fieldLabel}>{t('admin.users.roleLabel')}</Text>
            <View style={styles.optionRow}>
              {(['user', 'creator', 'admin'] as UserRole[]).map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[styles.optionBtn, newRole === role && styles.optionBtnActive]}
                  onPress={() => setNewRole(role)}
                >
                  <Text
                    style={[styles.optionBtnText, newRole === role && styles.optionBtnTextActive]}
                  >
                    {t(`roles.${role}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>{t('admin.users.localeLabel')}</Text>
            <View style={styles.optionRow}>
              {LOCALE_OPTIONS.map((loc) => (
                <TouchableOpacity
                  key={loc}
                  style={[styles.optionBtn, newLocale === loc && styles.optionBtnActive]}
                  onPress={() => setNewLocale(loc)}
                >
                  <Text
                    style={[styles.optionBtnText, newLocale === loc && styles.optionBtnTextActive]}
                  >
                    {loc}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowCreateModal(false)}
                disabled={creating}
              >
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleCreateUser}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('admin.users.createButton')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Editar Usuário */}
      <Modal visible={!!editingUser} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('admin.users.editModalTitle')}</Text>

            <Text style={styles.fieldLabel}>{t('admin.users.fullName')}</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.fieldLabel}>{t('admin.users.roleLabel')}</Text>
            <View style={styles.optionRow}>
              {(['user', 'creator', 'admin'] as UserRole[]).map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[styles.optionBtn, editRole === role && styles.optionBtnActive]}
                  onPress={() => setEditRole(role)}
                >
                  <Text
                    style={[styles.optionBtnText, editRole === role && styles.optionBtnTextActive]}
                  >
                    {t(`roles.${role}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>{t('admin.users.localeLabel')}</Text>
            <View style={styles.optionRow}>
              {LOCALE_OPTIONS.map((loc) => (
                <TouchableOpacity
                  key={loc}
                  style={[styles.optionBtn, editLocale === loc && styles.optionBtnActive]}
                  onPress={() => setEditLocale(loc)}
                >
                  <Text
                    style={[styles.optionBtnText, editLocale === loc && styles.optionBtnTextActive]}
                  >
                    {loc}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>{t('admin.users.activeSwitch')}</Text>
              <Switch
                value={editActive}
                onValueChange={setEditActive}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditingUser(null)}
                disabled={savingEdit}
              >
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleSaveEdit}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('admin.users.saveButton')}</Text>
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
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.primaryHover,
  },
  emptyBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  list: {
    gap: 10,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 14,
    flexWrap: 'wrap',
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  userEmail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  inactiveBadge: {
    backgroundColor: colors.dangerLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.danger,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
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
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: 6,
    padding: 20,
    gap: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 4,
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
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  optionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  optionBtnTextActive: {
    color: colors.primaryHover,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
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
