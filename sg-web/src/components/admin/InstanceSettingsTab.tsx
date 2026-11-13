import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'qrcode';
import { colors } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { adminService } from '@/services/admin.service';
import { getApiBaseUrl } from '@/services/serverConfig.service';
import { storageService } from '@/services/storage.service';
import { FilePicker, PickedFileItem } from '@/components/FilePicker';
import type { InstanceInfo, SupportedLocale } from '@/types/database';

const LOCALES: SupportedLocale[] = ['pt-BR', 'en', 'es'];

function QrMatrixView({ value, size = 180 }: { value: string; size?: number }) {
  const matrix = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      const count = qr.modules.size;
      const rows: boolean[][] = [];
      for (let r = 0; r < count; r += 1) {
        const row: boolean[] = [];
        for (let c = 0; c < count; c += 1) {
          row.push(Boolean(qr.modules.get(r, c)));
        }
        rows.push(row);
      }
      return { count, rows };
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) {
    return null;
  }

  const cellSize = Math.max(3, Math.floor(size / matrix.count));
  const totalSize = cellSize * matrix.count;

  return (
    <View style={[styles.qrFrame, { width: totalSize + 16, height: totalSize + 16 }]}>
      <View style={{ width: totalSize, height: totalSize }}>
        {matrix.rows.map((row, rIdx) => (
          <View key={rIdx} style={styles.qrRow}>
            {row.map((dark, cIdx) => (
              <View
                key={cIdx}
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: dark ? '#111827' : '#FFFFFF',
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

export function InstanceSettingsTab() {
  const { serverUrl, refreshInstanceInfo } = useAuth();
  const [info, setInfo] = useState<InstanceInfo | null>(null);
  const [siteName, setSiteName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [resolvedLogoUrl, setResolvedLogoUrl] = useState('');
  const [defaultLocale, setDefaultLocale] = useState<SupportedLocale>('pt-BR');
  const [allowPublicSignup, setAllowPublicSignup] = useState(false);
  const [effectiveServerUrl, setEffectiveServerUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [copiedConnectUrl, setCopiedConnectUrl] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const [instanceData, baseUrl] = await Promise.all([
        adminService.getInstanceInfo(),
        getApiBaseUrl(),
      ]);
      setInfo(instanceData);
      setSiteName(instanceData.name);
      setLogoUrl(instanceData.logoUrl ?? '');
      setDefaultLocale(instanceData.defaultLocale);
      setAllowPublicSignup(instanceData.allowPublicSignup);
      setEffectiveServerUrl(serverUrl || baseUrl);
      if (instanceData.logoUrl) {
        setResolvedLogoUrl(await storageService.resolveMediaUrl(instanceData.logoUrl));
      } else {
        setResolvedLogoUrl('');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao carregar configurações da instância.');
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadSettings();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSettings]);

  const handleUploadLogo = async (files: PickedFileItem[]) => {
    if (!files || files.length === 0) return;
    try {
      setUploadingLogo(true);
      const uploaded = await storageService.uploadMedia('instance-assets', files[0]);
      setLogoUrl(uploaded.url);
      setResolvedLogoUrl(await storageService.resolveMediaUrl(uploaded.signedUrl || uploaded.url));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao enviar logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    if (!siteName.trim()) {
      alert('Informe o nome da instância.');
      return;
    }

    try {
      setSaving(true);
      await adminService.updateInstanceSettings({
        siteName: siteName.trim(),
        logoUrl: logoUrl.trim() || null,
        defaultLocale,
        allowPublicSignup,
      });
      await Promise.all([loadSettings(), refreshInstanceInfo()]);
      alert('Configurações da instância salvas!');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

  const connectDeepLink = effectiveServerUrl
    ? `smartguide://connect?server=${encodeURIComponent(effectiveServerUrl)}`
    : '';

  const handleCopyConnectUrl = async () => {
    if (!connectDeepLink) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(connectDeepLink);
      setCopiedConnectUrl(true);
      setTimeout(() => setCopiedConnectUrl(false), 2500);
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 24 }} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Identidade e Cadastro da Instância</Text>

        <Text style={styles.label}>Nome da Instância *</Text>
        <TextInput
          style={styles.input}
          value={siteName}
          onChangeText={setSiteName}
          placeholder="Ex: Smart Guide - Minha Empresa"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>Logo da Instância</Text>
        {resolvedLogoUrl ? (
          <View style={styles.logoPreviewRow}>
            <Image source={{ uri: resolvedLogoUrl }} style={styles.logoPreview} resizeMode="contain" />
            <TouchableOpacity
              style={styles.removeLogoBtn}
              onPress={() => {
                setLogoUrl('');
                setResolvedLogoUrl('');
              }}
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.removeLogoText}>Remover Logo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FilePicker
            accept="image/*"
            buttonText="Enviar imagem de logo"
            iconName="image-outline"
            isUploading={uploadingLogo}
            onFilesSelected={handleUploadLogo}
          />
        )}

        <Text style={styles.label}>Idioma Padrão</Text>
        <View style={styles.localeRow}>
          {LOCALES.map((loc) => (
            <TouchableOpacity
              key={loc}
              style={[styles.localeBtn, defaultLocale === loc && styles.localeBtnActive]}
              onPress={() => setDefaultLocale(loc)}
            >
              <Text
                style={[styles.localeBtnText, defaultLocale === loc && styles.localeBtnTextActive]}
              >
                {loc}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Permitir cadastro público (Auto-registro)</Text>
            <Text style={styles.switchSub}>
              Quando desativado, apenas administradores podem cadastrar novos usuários.
            </Text>
          </View>
          <Switch
            value={allowPublicSignup}
            onValueChange={setAllowPublicSignup}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.saveBtnText}>Salvar Configurações</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Card: Conexão Mobile via QR Code */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Conectar App Mobile via QR Code</Text>
        <Text style={styles.cardSubtitle}>
          Escaneie este QR Code no aplicativo Smart Guide (Android/iOS) para configurar a URL deste servidor automaticamente.
        </Text>

        {connectDeepLink ? (
          <View style={styles.qrSection}>
            <QrMatrixView value={connectDeepLink} />
            <Text style={styles.deepLinkText} selectable>
              {connectDeepLink}
            </Text>
            {Platform.OS === 'web' && (
              <TouchableOpacity style={styles.copyBtn} onPress={handleCopyConnectUrl}>
                <Ionicons
                  name={copiedConnectUrl ? 'checkmark-outline' : 'copy-outline'}
                  size={16}
                  color={colors.text}
                />
                <Text style={styles.copyBtnText}>
                  {copiedConnectUrl ? 'Link copiado!' : 'Copiar link de conexão'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <View style={styles.metaFooter}>
          <Text style={styles.metaText}>Instance UUID: {info?.instanceUuid}</Text>
          <Text style={styles.metaText}>
            Licença: {info?.licenseConfigured ? `Ativa (${info.licenseKeyHint ?? 'configurada'})` : 'Modo comunitário'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 18,
    gap: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  label: {
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
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surfaceSubtle,
  },
  logoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoPreview: {
    width: 140,
    height: 48,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surfaceSubtle,
  },
  removeLogoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerLight,
  },
  removeLogoText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.danger,
  },
  localeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  localeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  localeBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  localeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  localeBtnTextActive: {
    color: colors.primaryHover,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 6,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  switchSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  saveBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 4,
    marginTop: 6,
  },
  saveBtnText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 14,
  },
  qrSection: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  qrFrame: {
    padding: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrRow: {
    flexDirection: 'row',
  },
  deepLinkText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  metaFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 10,
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
