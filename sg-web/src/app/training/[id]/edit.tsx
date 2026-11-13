// ==============================================================================
// Tela: Editor do Treinamento (Detalhes + Etapas)
// Permite editar os dados base do treinamento e gerenciar suas etapas
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
  Alert,
  Image,
  Switch,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../constants/colors';
import { stepsService } from '../../../services/steps.service';
import { trainingsService } from '../../../services/trainings.service';
import { categoriesService } from '../../../services/categories.service';
import { storageService } from '../../../services/storage.service';
import { attachmentsService } from '../../../services/attachments.service';
import { Training, TrainingStep, StepAttachment, Category, TrainingStatus } from '../../../types/database';
import { RichTextEditor } from '../../../components/RichTextEditor';
import { FilePicker, PickedFileItem } from '../../../components/FilePicker';

export default function EditTrainingStepsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const topPadding = Platform.OS !== 'web' ? insets.top + 10 : 16;
  const bottomPadding = Platform.OS !== 'web' ? insets.bottom + 24 : 32;

  // Aba ativa: 'details' (dados do treinamento) ou 'steps' (etapas)
  const [activeTab, setActiveTab] = useState<'details' | 'steps'>('steps');

  const [training, setTraining] = useState<Training | null>(null);
  const [steps, setSteps] = useState<TrainingStep[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Campos de edição dos detalhes do treinamento ---
  const [detailTitle, setDetailTitle] = useState('');
  const [detailDescription, setDetailDescription] = useState('');
  const [detailCoverUrl, setDetailCoverUrl] = useState('');
  const [detailCoverPreviewUrl, setDetailCoverPreviewUrl] = useState('');
  const [detailStatus, setDetailStatus] = useState<TrainingStatus>('draft');
  const [detailIsPublic, setDetailIsPublic] = useState(true);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);

  // --- Campos de edição das etapas ---
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepTitle, setStepTitle] = useState('');
  const [stepContent, setStepContent] = useState('');
  const [attachments, setAttachments] = useState<StepAttachment[]>([]);
  const [resolvedThumbUrls, setResolvedThumbUrls] = useState<Record<string, string>>({});
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [savingStep, setSavingStep] = useState(false);

  // Carrega os dados do treinamento, etapas e categorias
  const loadAll = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [tData, sData, cats] = await Promise.all([
        trainingsService.getTrainingById(id),
        stepsService.getSteps(id),
        categoriesService.getCategories(),
      ]);
      setTraining(tData);
      setSteps(sData);
      setAvailableCategories(cats);

      if (tData) {
        setDetailTitle(tData.title);
        setDetailDescription(tData.description);
        setDetailCoverUrl(tData.cover_url || '');
        const resolvedCover = await storageService.resolveMediaUrl(tData.cover_url);
        setDetailCoverPreviewUrl(resolvedCover);
        setDetailStatus(tData.status);
        setDetailIsPublic(tData.is_public);
        setSelectedCategoryIds((tData.categories || []).map((c) => c.id));

        // Se estiver arquivado, solicita confirmação para desarquivar antes de permitir edição
        if (tData.status === 'archived') {
          const doUnarchive = async () => {
            try {
              const updated = await trainingsService.updateTraining(id, { status: 'draft' });
              setDetailStatus(updated.status);
              setTraining((prev) => (prev ? { ...prev, status: updated.status } : prev));
              alert('Treinamento desarquivado com sucesso! Agora você pode editá-lo.');
            } catch (err: unknown) {
              alert(err instanceof Error ? err.message : 'Erro ao desarquivar.');
              router.back();
            }
          };

          if (typeof window !== 'undefined' && window.confirm) {
            if (
              window.confirm(
                'Este treinamento está arquivado. Deseja desarquivá-lo para poder editar?'
              )
            ) {
              await doUnarchive();
            } else {
              router.back();
            }
          } else {
            Alert.alert(
              'Treinamento Arquivado',
              'Este treinamento está arquivado. Deseja desarquivá-lo para poder editar?',
              [
                { text: 'Cancelar', style: 'cancel', onPress: () => router.back() },
                { text: 'Desarquivar e Editar', onPress: doUnarchive },
              ]
            );
          }
        }
      }
    } catch (error) {
      console.error('Erro ao carregar editor:', error);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadAll();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    async function resolveThumbnails() {
      const next: Record<string, string> = {};
      await Promise.all(
        attachments.map(async (att) => {
          if (att.file_type === 'image' && att.file_url) {
            next[att.id] = await storageService.resolveMediaUrl(att.file_url);
          }
        }),
      );
      if (!cancelled) setResolvedThumbUrls(next);
    }
    resolveThumbnails();
    return () => {
      cancelled = true;
    };
  }, [attachments]);

  // Alterna seleção de categoria nos detalhes
  const toggleCategory = (catId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((i) => i !== catId) : [...prev, catId]
    );
  };

  // Upload da imagem de capa
  const handleCoverUpload = async (files: PickedFileItem[]) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    try {
      setIsUploadingCover(true);
      const uploaded = await storageService.uploadMedia('training-covers', file);
      setDetailCoverUrl(uploaded.url);
      const resolved = await storageService.resolveMediaUrl(uploaded.signedUrl || uploaded.url);
      setDetailCoverPreviewUrl(resolved);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setIsUploadingCover(false);
    }
  };

  // Salva os detalhes base do treinamento
  const handleSaveDetails = async () => {
    if (!id) return;
    if (!detailTitle.trim()) {
      alert('O título do treinamento é obrigatório.');
      return;
    }
    try {
      setSavingDetails(true);
      const updated = await trainingsService.updateTraining(id, {
        title: detailTitle.trim(),
        description: detailDescription.trim(),
        coverUrl: detailCoverUrl.trim() || null,
        status: detailStatus,
        isPublic: detailIsPublic,
        categoryIds: selectedCategoryIds,
      });

      if (detailStatus === 'archived') {
        alert('Treinamento salvo e arquivado com sucesso!');
        router.back();
      } else {
        alert('Dados do treinamento atualizados!');
        setTraining(updated);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar alterações.');
    } finally {
      setSavingDetails(false);
    }
  };

  // Limpa o formulário de etapa
  const resetForm = () => {
    setEditingStepId(null);
    setStepTitle('');
    setStepContent('');
    setAttachments([]);
  };

  // Carrega etapa para edição
  const handleEditStep = (step: TrainingStep) => {
    setEditingStepId(step.id);
    setStepTitle(step.title);
    setStepContent(step.content);
    setAttachments(step.attachments || []);
  };

  // Upload de mídias para a etapa
  const handleFilesSelected = async (files: PickedFileItem[]) => {
    if (!files || files.length === 0 || !id) return;
    try {
      setIsUploadingMedia(true);
      for (const file of files) {
        const result = await storageService.uploadMedia('step-attachments', file);
        if (editingStepId) {
          const attachment = await attachmentsService.createAttachment(editingStepId, {
            fileName: result.fileName,
            storageKey: result.storageKey,
            fileUrl: result.url,
            fileType: result.fileType,
            mimeType: result.mimeType,
            fileSize: result.fileSize,
          });
          setAttachments((prev) => [...prev, attachment]);
        } else {
          const pendingAtt: StepAttachment = {
            id: `temp-${Date.now()}-${Math.random()}`,
            step_id: '',
            file_name: result.fileName,
            storage_key: result.storageKey,
            file_url: result.url,
            file_type: result.fileType,
            mime_type: result.mimeType,
            file_size: result.fileSize,
          };
          setAttachments((prev) => [...prev, pendingAtt]);
        }
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro durante o upload.');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // Remover anexo
  const handleRemoveAttachment = async (attId: string) => {
    if (editingStepId && !attId.startsWith('temp-')) {
      await attachmentsService.deleteAttachment(attId);
    }
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  // Reordenar anexo para cima
  const handleMoveAttachmentUp = async (index: number) => {
    if (index <= 0) return;
    const next = [...attachments];
    const temp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = temp;
    setAttachments(next);
    if (editingStepId) {
      const persistedIds = next.filter((a) => !a.id.startsWith('temp-')).map((a) => a.id);
      if (persistedIds.length > 0) {
        await attachmentsService.reorderAttachments(editingStepId, persistedIds);
      }
    }
  };

  // Reordenar anexo para baixo
  const handleMoveAttachmentDown = async (index: number) => {
    if (index >= attachments.length - 1) return;
    const next = [...attachments];
    const temp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = temp;
    setAttachments(next);
    if (editingStepId) {
      const persistedIds = next.filter((a) => !a.id.startsWith('temp-')).map((a) => a.id);
      if (persistedIds.length > 0) {
        await attachmentsService.reorderAttachments(editingStepId, persistedIds);
      }
    }
  };

  // Salvar etapa (nova ou atualização)
  const handleSaveStep = async () => {
    if (!id) return;
    if (!stepTitle.trim()) {
      alert('Informe o título da etapa.');
      return;
    }
    try {
      setSavingStep(true);
      if (editingStepId) {
        await stepsService.updateStep(editingStepId, {
          title: stepTitle.trim(),
          content: stepContent.trim(),
        });
        const persistedIds = attachments.filter((a) => !a.id.startsWith('temp-')).map((a) => a.id);
        if (persistedIds.length > 0) {
          await attachmentsService.reorderAttachments(editingStepId, persistedIds);
        }
        alert('Etapa atualizada!');
        resetForm();
        await loadAll();
      } else {
        const step = await stepsService.createStep(id, {
          title: stepTitle.trim(),
          content: stepContent.trim(),
          stepOrder: steps.length + 1,
        });
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          await attachmentsService.createAttachment(step.id, {
            fileName: att.file_name,
            storageKey: att.storage_key || att.file_url,
            fileUrl: att.file_url,
            fileType: att.file_type,
            mimeType: att.mime_type || (att.file_type === 'video' ? 'video/mp4' : 'image/jpeg'),
            fileSize: att.file_size || 0,
            attOrder: i + 1,
          });
        }
        alert('Etapa adicionada!');
        resetForm();
        await loadAll();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar etapa.');
    } finally {
      setSavingStep(false);
    }
  };

  // Excluir etapa
  const handleDeleteStep = (stepId: string, title: string) => {
    const confirmDelete = async () => {
      try {
        await stepsService.deleteStep(stepId);
        setSteps((prev) => prev.filter((s) => s.id !== stepId));
        if (editingStepId === stepId) resetForm();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Erro ao excluir etapa.');
      }
    };

    if (typeof window !== 'undefined' && window.confirm) {
      if (window.confirm(`Deseja excluir a etapa "${title}"?`)) {
        confirmDelete();
      }
    } else {
      Alert.alert('Excluir Etapa', `Deseja excluir a etapa "${title}"?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: confirmDelete },
      ]);
    }
  };

  // Persistir nova ordenação das etapas no backend
  const persistStepOrder = async (previousSteps: TrainingStep[], nextSteps: TrainingStep[]) => {
    setSteps(nextSteps);
    if (!id) return;
    try {
      const reordered = await stepsService.reorderSteps(
        id,
        nextSteps.map((s) => s.id),
      );
      setSteps(reordered);
    } catch (err: unknown) {
      setSteps(previousSteps);
      alert(err instanceof Error ? err.message : 'Erro ao salvar nova ordenação das etapas.');
    }
  };

  // Mover etapa para cima
  const moveUp = async (index: number) => {
    if (index === 0) return;
    const previousSteps = steps;
    const nextSteps = [...steps];
    const temp = nextSteps[index];
    nextSteps[index] = nextSteps[index - 1];
    nextSteps[index - 1] = temp;
    await persistStepOrder(previousSteps, nextSteps);
  };

  // Mover etapa para baixo
  const moveDown = async (index: number) => {
    if (index >= steps.length - 1) return;
    const previousSteps = steps;
    const nextSteps = [...steps];
    const temp = nextSteps[index];
    nextSteps[index] = nextSteps[index + 1];
    nextSteps[index + 1] = temp;
    await persistStepOrder(previousSteps, nextSteps);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando editor...</Text>
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
          <Text style={styles.backBtnText}>Concluir e Ver Treinamento</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{training?.title}</Text>
      </View>

      {/* Navegação entre abas: Detalhes e Etapas */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'details' && styles.tabBtnActive]}
          onPress={() => setActiveTab('details')}
        >
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={activeTab === 'details' ? colors.primaryHover : colors.textSecondary}
          />
          <Text style={[styles.tabBtnText, activeTab === 'details' && styles.tabBtnTextActive]}>
            Dados do Treinamento
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'steps' && styles.tabBtnActive]}
          onPress={() => setActiveTab('steps')}
        >
          <Ionicons
            name="list-outline"
            size={16}
            color={activeTab === 'steps' ? colors.primaryHover : colors.textSecondary}
          />
          <Text style={[styles.tabBtnText, activeTab === 'steps' && styles.tabBtnTextActive]}>
            Etapas
          </Text>
        </TouchableOpacity>
      </View>

      {/* =================== ABA: DADOS DO TREINAMENTO =================== */}
      {activeTab === 'details' && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Editar Dados do Treinamento</Text>
          <Text style={styles.sectionSubtitle}>
            Altere o título, descrição, capa, categorias e o status de publicação.
          </Text>

          {/* Título */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Título *</Text>
            <TextInput
              style={styles.input}
              value={detailTitle}
              onChangeText={setDetailTitle}
              placeholder="Título do treinamento"
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {/* Descrição (Rich Text) */}
          <View style={styles.inputGroup}>
            <RichTextEditor
              label="Descrição"
              value={detailDescription}
              onChangeText={setDetailDescription}
              placeholder="Descreva o objetivo e o público deste treinamento..."
            />
          </View>

          {/* Imagem de Capa */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Imagem de Capa</Text>
            {detailCoverUrl ? (
              <View style={styles.coverPreviewBox}>
                <Image
                  source={{ uri: detailCoverPreviewUrl || detailCoverUrl }}
                  style={styles.coverPreviewImage}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  style={styles.removeCoverBtn}
                  onPress={() => {
                    setDetailCoverUrl('');
                    setDetailCoverPreviewUrl('');
                  }}
                >
                  <Ionicons name="trash" size={16} color="#FFF" />
                  <Text style={styles.removeCoverText}>Remover</Text>
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

          {/* Categorias */}
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

          {/* Status */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Status de Publicação</Text>
            <View style={styles.statusButtons}>
              {(['draft', 'published', 'archived'] as TrainingStatus[]).map((st) => (
                <TouchableOpacity
                  key={st}
                  style={[styles.statusOption, detailStatus === st && styles.statusOptionActive]}
                  onPress={() => setDetailStatus(st)}
                >
                  <Text style={[styles.statusOptionText, detailStatus === st && styles.statusOptionTextActive]}>
                    {st === 'draft' ? 'Rascunho' : st === 'published' ? 'Publicado' : 'Arquivado'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Visibilidade */}
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>Disponível para toda a empresa</Text>
              <Text style={styles.switchSubtitle}>
                Todos os colaboradores da empresa poderão visualizar este treinamento.
              </Text>
            </View>
            <Switch
              value={detailIsPublic}
              onValueChange={setDetailIsPublic}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          {/* Botão Salvar Detalhes */}
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSaveDetails}
            disabled={savingDetails}
          >
            {savingDetails ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Salvar Alterações</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* =================== ABA: ETAPAS =================== */}
      {activeTab === 'steps' && (
        <>
          {/* Lista de Etapas */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Etapas</Text>
              <Text style={styles.sectionSubtitle}>
                Use as setas para reordenar a sequência exibida aos colaboradores.
              </Text>
            </View>

            {steps.length === 0 ? (
              <View style={styles.emptySteps}>
                <Text style={styles.emptyStepsText}>
                  Nenhuma etapa criada ainda. Use o formulário abaixo para adicionar a primeira.
                </Text>
              </View>
            ) : (
              <View style={styles.stepsList}>
                {steps.map((step, index) => (
                  <View key={step.id} style={styles.stepItemRow}>
                    <View style={styles.stepInfo}>
                      <View style={styles.orderBadge}>
                        <Text style={styles.orderBadgeText}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.stepItemTitle}>{step.title}</Text>
                        {step.attachments && step.attachments.length > 0 && (
                          <Text style={styles.stepAttInfo}>
                            📎 {step.attachments.length}{' '}
                            {step.attachments.length === 1 ? 'mídia' : 'mídias'}
                          </Text>
                        )}
                      </View>
                    </View>

                    <View style={styles.stepActions}>
                      <TouchableOpacity
                        style={[styles.iconBtn, index === 0 && styles.iconBtnDisabled]}
                        disabled={index === 0}
                        onPress={() => moveUp(index)}
                      >
                        <Ionicons name="arrow-up" size={16} color={colors.text} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.iconBtn, index === steps.length - 1 && styles.iconBtnDisabled]}
                        disabled={index === steps.length - 1}
                        onPress={() => moveDown(index)}
                      >
                        <Ionicons name="arrow-down" size={16} color={colors.text} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => handleEditStep(step)}
                      >
                        <Ionicons name="create-outline" size={16} color={colors.primaryHover} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => handleDeleteStep(step.id, step.title)}
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.danger} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Formulário: Adicionar ou Editar Etapa */}
          <View style={[styles.card, { marginTop: 20 }]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {editingStepId ? 'Editar Etapa' : 'Adicionar Nova Etapa'}
              </Text>
              {editingStepId && (
                <TouchableOpacity onPress={resetForm}>
                  <Text style={styles.cancelEditLink}>Cancelar edição</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Título da Etapa *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Normas de Utilização do Equipamento"
                placeholderTextColor={colors.textMuted}
                value={stepTitle}
                onChangeText={setStepTitle}
              />
            </View>

            <View style={styles.inputGroup}>
              <RichTextEditor
                label="Conteúdo da Etapa"
                value={stepContent}
                onChangeText={setStepContent}
                placeholder="Digite o conteúdo detalhado da etapa..."
                minHeight={180}
              />
            </View>

            {/* Mídias */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Imagens e Vídeos da Etapa</Text>
              <Text style={styles.helperText}>
                Adicione múltiplas imagens ou vídeos para enriquecer o conteúdo desta etapa.
              </Text>

              <FilePicker
                accept="image/*,video/*"
                multiple={true}
                buttonText="+ Adicionar imagem ou vídeo"
                isUploading={isUploadingMedia}
                onFilesSelected={handleFilesSelected}
              />

              {attachments.length > 0 && (
                <View style={styles.attachmentsList}>
                  {attachments.map((att, index) => (
                    <View key={att.id} style={styles.attRow}>
                      <View style={styles.attRowLeft}>
                        <Ionicons
                          name={att.file_type === 'video' ? 'videocam' : 'image'}
                          size={20}
                          color={att.file_type === 'video' ? '#9B59B6' : colors.primary}
                        />
                        {att.file_type === 'image' && (resolvedThumbUrls[att.id] || att.file_url) ? (
                          <Image
                            source={{ uri: resolvedThumbUrls[att.id] || att.file_url }}
                            style={styles.miniThumbnail}
                          />
                        ) : null}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.attFileName} numberOfLines={1}>
                            {att.file_name}
                          </Text>
                          <Text style={styles.attBadge}>
                            {index + 1}º • {att.file_type === 'video' ? 'VÍDEO' : 'IMAGEM'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.attActions}>
                        <TouchableOpacity
                          style={[styles.reorderAttBtn, index === 0 && styles.reorderAttBtnDisabled]}
                          onPress={() => handleMoveAttachmentUp(index)}
                          disabled={index === 0}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons
                            name="chevron-up"
                            size={18}
                            color={index === 0 ? colors.border : colors.text}
                          />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.reorderAttBtn, index === attachments.length - 1 && styles.reorderAttBtnDisabled]}
                          onPress={() => handleMoveAttachmentDown(index)}
                          disabled={index === attachments.length - 1}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons
                            name="chevron-down"
                            size={18}
                            color={index === attachments.length - 1 ? colors.border : colors.text}
                          />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.removeAttBtn}
                          onPress={() => handleRemoveAttachment(att.id)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.saveStepBtn}
              onPress={handleSaveStep}
              disabled={savingStep}
            >
              {savingStep ? (
                <ActivityIndicator color={colors.textInverse} size="small" />
              ) : (
                <Text style={styles.saveStepBtnText}>
                  {editingStepId ? 'Salvar Alterações da Etapa' : '+ Inserir Esta Etapa'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
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
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 8,
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
  topTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
  // Abas
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 3,
    backgroundColor: colors.surface,
  },
  tabBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabBtnTextActive: {
    color: colors.primaryHover,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 20,
  },
  sectionHeader: {
    marginBottom: 12,
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
  cancelEditLink: {
    color: colors.primaryHover,
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptySteps: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 18,
    alignItems: 'center',
  },
  emptyStepsText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  stepsList: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
  },
  stepItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  stepInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  orderBadge: {
    width: 24,
    height: 24,
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: {
    color: colors.primaryHover,
    fontSize: 12,
    fontWeight: 'bold',
  },
  stepItemTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  stepAttInfo: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  stepActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    padding: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconBtnDisabled: {
    opacity: 0.3,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  helperText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
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
    height: 160,
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
  statusButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  statusOption: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 3,
  },
  statusOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  statusOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  statusOptionTextActive: {
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
    marginBottom: 20,
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
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 14,
  },
  attachmentsList: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    backgroundColor: '#FAFAFA',
  },
  attRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  attRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  miniThumbnail: {
    width: 32,
    height: 32,
    borderRadius: 2,
    backgroundColor: '#DDD',
  },
  attFileName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    maxWidth: 240,
  },
  attBadge: {
    fontSize: 9,
    fontWeight: 'bold',
    color: colors.textSecondary,
  },
  attActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reorderAttBtn: {
    padding: 4,
    borderRadius: 3,
  },
  reorderAttBtnDisabled: {
    opacity: 0.3,
  },
  removeAttBtn: {
    padding: 6,
    marginLeft: 4,
  },
  saveStepBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveStepBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 14,
  },
});
