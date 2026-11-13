// ==============================================================================
// Tela: Criar Treinamento (CreateTrainingScreen)
// Status padrão "Rascunho", upload de capa via Supabase Storage e Rich Text WYSIWYG
// ==============================================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { trainingsService } from '../../services/trainings.service';
import { categoriesService } from '../../services/categories.service';
import { storageService } from '../../services/storage.service';
import { Category, TrainingStatus } from '../../types/database';
import { RichTextEditor } from '../../components/RichTextEditor';
import { FilePicker } from '../../components/FilePicker';

export default function CreateTrainingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const topPadding = Platform.OS !== 'web' ? insets.top + 10 : 16;
  const bottomPadding = Platform.OS !== 'web' ? insets.bottom + 24 : 32;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  // Todo novo treinamento é sempre criado com status "draft" (Rascunho)
  const status: TrainingStatus = 'draft';
  const [isPublic, setIsPublic] = useState(true);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);

  // Verifica permissão para criar treinamentos (Super Admin, Admin da Empresa ou Criador)
  useEffect(() => {
    if (user && !['super_admin', 'company_admin', 'creator'].includes(user.role)) {
      alert('Você não tem permissão para criar treinamentos. Solicite acesso ao administrador da sua empresa.');
      router.back();
    }
  }, [user]);

  // Carrega categorias disponíveis da empresa
  useEffect(() => {
    async function fetchCategories() {
      const cats = await categoriesService.getCategories(user?.company_id);
      setAvailableCategories(cats);
    }
    fetchCategories();
  }, [user?.company_id]);

  // Upload da imagem de capa para o Supabase Storage
  const handleCoverUpload = async (files: File[]) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    try {
      setIsUploadingCover(true);
      const companyId = user?.company_id || 'global';
      const { url, error } = await storageService.uploadTrainingCover(file, file.name, companyId);

      if (error || !url) {
        alert(error || 'Erro ao carregar a imagem de capa.');
      } else {
        setCoverUrl(url);
      }
    } catch (err: any) {
      alert(err.message || 'Erro inesperado no envio da imagem.');
    } finally {
      setIsUploadingCover(false);
    }
  };

  // Alterna seleção de categoria
  const toggleCategory = (catId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  // Salvar treinamento
  const handleSave = async () => {
    if (!title.trim()) {
      alert('Por favor, informe o título do treinamento.');
      return;
    }

    try {
      setSaving(true);
      const companyId = user?.company_id || 'a0000000-0000-0000-0000-000000000001';
      const userId = user?.id || 'd0000000-0000-0000-0000-000000000001';

      const { training, error } = await trainingsService.createTraining(
        {
          company_id: companyId,
          created_by: userId,
          title: title.trim(),
          description: description.trim(),
          cover_url: coverUrl.trim(),
          status,
          is_public: isPublic,
        },
        selectedCategoryIds
      );

      if (error || !training) {
        alert(error || 'Erro ao criar treinamento.');
      } else {
        alert('Treinamento salvo como Rascunho! Agora adicione as etapas.');
        router.replace(`/training/${training.id}/edit` as any);
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar treinamento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: topPadding, paddingBottom: bottomPadding },
      ]}
    >
      {/* Barra de Ações Superior */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
          <Text style={styles.backBtnText}>Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Novo Treinamento</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.card}>
        {/* Título */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Título do Treinamento *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Integração de Novos Colaboradores"
            placeholderTextColor={colors.textMuted}
            value={title}
            onChangeText={setTitle}
          />
        </View>

        {/* Editor de Descrição com Rich Text WYSIWYG */}
        <View style={styles.inputGroup}>
          <RichTextEditor
            label="Descrição do Treinamento"
            value={description}
            onChangeText={setDescription}
            placeholder="Descreva os objetivos, para quem é destinado e as instruções..."
          />
        </View>

        {/* Upload de Imagem de Capa */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Imagem de Capa</Text>
          {coverUrl ? (
            <View style={styles.coverPreviewBox}>
              <Image source={{ uri: coverUrl }} style={styles.coverPreviewImage} resizeMode="cover" />
              <TouchableOpacity style={styles.removeCoverBtn} onPress={() => setCoverUrl('')}>
                <Ionicons name="trash" size={16} color="#FFF" />
                <Text style={styles.removeCoverText}>Remover Capa</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FilePicker
              accept="image/*"
              buttonText="Selecionar imagem de capa"
              iconName="image-outline"
              isUploading={isUploadingCover}
              onFilesSelected={handleCoverUpload}
            />
          )}
        </View>

        {/* Categorias (Seleção Múltipla) */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Categorias</Text>
          <View style={styles.categoriesWrap}>
            {availableCategories.map((cat) => {
              const isSelected = selectedCategoryIds.includes(cat.id);
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.catChip,
                    isSelected && { backgroundColor: cat.color, borderColor: cat.color },
                  ]}
                  onPress={() => toggleCategory(cat.id)}
                >
                  <Text style={[styles.catChipText, isSelected && styles.catChipTextActive]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Visibilidade Pública */}
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Disponível para toda a empresa</Text>
            <Text style={styles.switchSubtitle}>
              Se ativado, todos os colaboradores da empresa poderão visualizar este treinamento.
            </Text>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>

        {/* Botão de Salvar */}
        <View style={styles.actionFooter}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => router.back()}
            disabled={saving}
          >
            <Text style={styles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Salvar Rascunho e Configurar Etapas →</Text>
            )}
          </TouchableOpacity>
        </View>
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
    maxWidth: 800,
    width: '100%',
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  screenTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  coverPreviewBox: {
    height: 180,
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
  },
  coverPreviewImage: {
    width: '100%',
    height: '100%',
  },
  removeCoverBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(231, 76, 60, 0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 3,
  },
  removeCoverText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  categoriesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  catChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  catChipTextActive: {
    color: colors.textInverse,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: 24,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  switchSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 3,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 3,
  },
  saveBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 14,
  },
});
