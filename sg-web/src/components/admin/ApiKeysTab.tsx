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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/constants/colors';
import { translateApiError } from '@/i18n/errorMapper';
import { adminService } from '@/services/admin.service';
import type { ApiKeyScope, ApiKeySummary } from '@/types/database';

const ALL_SCOPES: { value: ApiKeyScope; label: string }[] = [
  { value: 'users:read', label: 'users:read' },
  { value: 'users:write', label: 'users:write' },
  { value: 'trainings:read', label: 'trainings:read' },
];

export function ApiKeysTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([
    'users:read',
    'trainings:read',
  ]);
  const [creating, setCreating] = useState(false);

  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      setLoading(true);
      const list = await adminService.listApiKeys();
      setKeys(list);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao listar chaves de API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadKeys();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadKeys]);

  const toggleScope = (scope: ApiKeyScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleCreateKey = async () => {
    if (!newName.trim()) {
      alert(t('admin.apiKeys.nameRequired'));
      return;
    }
    if (selectedScopes.length === 0) {
      alert(t('admin.apiKeys.scopesRequired'));
      return;
    }

    try {
      setCreating(true);
      const res = await adminService.createApiKey({
        name: newName.trim(),
        scopes: selectedScopes,
      });
      setShowCreateModal(false);
      setNewName('');
      setKeys((prev) => [res.apiKey, ...prev]);
      setCopiedKey(false);
      setRevealedKey(res.plaintextKey);
    } catch (err: unknown) {
      alert(translateApiError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (item: ApiKeySummary) => {
    try {
      const updated = await adminService.updateApiKey(item.id, { isActive: !item.isActive });
      setKeys((prev) => prev.map((k) => (k.id === updated.id ? updated : k)));
    } catch (err: unknown) {
      alert(translateApiError(err));
    }
  };

  const handleDeleteKey = (item: ApiKeySummary) => {
    const doDelete = async () => {
      try {
        await adminService.deleteApiKey(item.id);
        setKeys((prev) => prev.filter((k) => k.id !== item.id));
      } catch (err: unknown) {
        alert(translateApiError(err));
      }
    };

    const confirmMsg = t('admin.apiKeys.revokeConfirm', { name: item.name });
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

  const handleCopyRevealedKey = async () => {
    if (!revealedKey) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(revealedKey);
      setCopiedKey(true);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('admin.apiKeys.title')}</Text>
          <Text style={styles.subtitle}>{t('admin.apiKeys.subtitle')}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/swagger' as never)}
          >
            <Ionicons name="book-outline" size={16} color={colors.text} />
            <Text style={styles.secondaryBtnText}>{t('admin.apiKeys.docsButton')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowCreateModal(true)}>
            <Ionicons name="key-outline" size={16} color={colors.textInverse} />
            <Text style={styles.primaryBtnText}>{t('admin.apiKeys.generateButton')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 24 }} />
      ) : keys.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>{t('admin.apiKeys.empty')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {keys.map((item) => (
            <View key={item.id} style={styles.keyCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.keyName}>{item.name}</Text>
                <Text style={styles.keyPrefix}>
                  {t('admin.apiKeys.keyPrefix', { prefix: item.keyPrefix })}
                </Text>
                <View style={styles.scopesWrap}>
                  {item.scopes.map((sc) => (
                    <View key={sc} style={styles.scopeChip}>
                      <Text style={styles.scopeChipText}>{sc}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.keyControls}>
                <Switch
                  value={item.isActive}
                  onValueChange={() => handleToggleActive(item)}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
                <TouchableOpacity style={styles.iconBtn} onPress={() => handleDeleteKey(item)}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Modal: Criar Chave */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('admin.apiKeys.createModalTitle')}</Text>

            <Text style={styles.fieldLabel}>{t('admin.apiKeys.integrationName')}</Text>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('admin.apiKeys.integrationName')}
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.fieldLabel}>{t('admin.apiKeys.scopesLabel')}</Text>
            <View style={styles.scopesWrap}>
              {ALL_SCOPES.map((sc) => {
                const active = selectedScopes.includes(sc.value);
                return (
                  <TouchableOpacity
                    key={sc.value}
                    style={[styles.scopeOption, active && styles.scopeOptionActive]}
                    onPress={() => toggleScope(sc.value)}
                  >
                    <Text style={[styles.scopeOptionText, active && styles.scopeOptionTextActive]}>
                      {sc.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
                onPress={handleCreateKey}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('admin.apiKeys.generateButton')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Exibir Chave em Texto Claro (uma única vez) */}
      <Modal visible={!!revealedKey} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('admin.apiKeys.secretModalTitle')}</Text>
            <Text style={styles.warningText}>{t('admin.apiKeys.secretWarning')}</Text>

            <TextInput
              style={[styles.input, styles.secretInput]}
              value={revealedKey ?? ''}
              editable={false}
              selectTextOnFocus
              multiline
            />

            <View style={styles.modalFooter}>
              {Platform.OS === 'web' && (
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleCopyRevealedKey}>
                  <Ionicons
                    name={copiedKey ? 'checkmark-outline' : 'copy-outline'}
                    size={16}
                    color={colors.text}
                  />
                  <Text style={styles.secondaryBtnText}>
                    {copiedKey ? t('common.copied') : t('common.copy')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setRevealedKey(null)}>
                <Text style={styles.primaryBtnText}>{t('admin.apiKeys.understoodClose')}</Text>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 4,
  },
  secondaryBtnText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
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
  keyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 14,
  },
  keyName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  keyPrefix: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: 6,
  },
  scopesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  scopeChip: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  scopeChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  keyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    maxWidth: 460,
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
  warningText: {
    fontSize: 13,
    color: colors.danger,
    fontWeight: '600',
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
  secretInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    fontWeight: '700',
  },
  scopeOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  scopeOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  scopeOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  scopeOptionTextActive: {
    color: colors.primaryHover,
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
