// ==============================================================================
// Tela: Player e Visualizador do Treinamento (PlayerTreinamento_Screen)
// Réplica aprimorada do Power Apps com modo Visão Geral e Modo Estudo (Player)
// ==============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Modal,
  Alert,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../../../constants/colors';
import { useAuth } from '../../../context/AuthContext';
import { trainingsService } from '../../../services/trainings.service';
import { stepsService } from '../../../services/steps.service';
import { progressService } from '../../../services/progress.service';
import { offlineService } from '../../../services/offline.service';
import { pdfService } from '../../../services/pdf.service';
import { storageService } from '../../../services/storage.service';
import { Training, TrainingStep, StepAttachment } from '../../../types/database';
import { RichTextViewer } from '../../../components/RichTextViewer';
import { Header } from '../../../components/Header';
import { Footer } from '../../../components/Footer';

function NativeVideoPlayer({
  uri,
  autoPlay = false,
  style,
}: {
  uri: string;
  autoPlay?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    if (autoPlay) {
      instance.play();
    }
  });

  return (
    <VideoView
      player={player}
      style={style}
      nativeControls
      contentFit="contain"
    />
  );
}

export default function TrainingPlayerScreen() {
  const { id, fromTrainings } = useLocalSearchParams<{ id: string; fromTrainings?: string }>();
  const router = useRouter();
  const { user } = useAuth();

  // O progresso só funciona de fato quando o treinamento é aberto pela tela de treinamentos
  const canTrackProgress = fromTrainings === 'true' || fromTrainings === '1';

  const [training, setTraining] = useState<Training | null>(null);
  const [steps, setSteps] = useState<TrainingStep[]>([]);
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState('');
  const [resolvedMediaUrls, setResolvedMediaUrls] = useState<Record<string, string>>({});
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Estado de download offline
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgressMsg, setDownloadProgressMsg] = useState('');
  const [downloadProgressPct, setDownloadProgressPct] = useState(0);

  // Sincronização automática em background se houver modificação no servidor
  const [autoUpdateMessage, setAutoUpdateMessage] = useState<string | null>(null);
  const [isAutoUpdating, setIsAutoUpdating] = useState(false);

  // Geração do PDF para impressão
  const [isPrinting, setIsPrinting] = useState(false);

  // Mídia expandida em popup (lightbox)
  const [expandedMedia, setExpandedMedia] = useState<StepAttachment | null>(null);

  // Modo da tela: 'overview' (visão geral/detalhes) ou 'study' (player de estudo)
  const [mode, setMode] = useState<'overview' | 'study'>('overview');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Carrega os dados do treinamento, etapas e progresso do usuário (com suporte offline instantâneo e auto-update)
  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      // 1. Tenta carregar IMEDIATAMENTE do armazenamento offline local
      const offlineData = await offlineService.getOfflineTraining(id);
      const wasDownloaded = !!offlineData;
      setIsDownloaded(wasDownloaded);

      if (offlineData) {
        setTraining(offlineData.training);
        setSteps(offlineData.steps);
        setLoading(false);
      } else {
        setLoading(true);
      }

      // 2. Se o dispositivo estiver comprovadamente offline, encerra imediatamente sem travar
      const isDefinitelyOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isDefinitelyOffline && offlineData) {
        return;
      }

      // 3. Busca online com timeout de segurança (3.5 segundos)
      const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) =>
        setTimeout(() => resolve({ isTimeout: true }), 3500)
      );

      const networkPromise = Promise.all([
        trainingsService.getTrainingById(id),
        stepsService.getSteps(id),
      ]);

      const raceResult = await Promise.race([networkPromise, timeoutPromise]);

      if ('isTimeout' in raceResult) {
        console.warn('[Offline] Rede inacessível ou lenta. Mantendo dados locais offline.');
        if (!offlineData) {
          setLoading(false);
        }
        return;
      }

      const [onlineTraining, onlineSteps] = raceResult;

      if (!onlineTraining) {
        if (!offlineData) setLoading(false);
        return;
      }

      // 4. Verificação de atualização automática quando online
      if (wasDownloaded && offlineData) {
        const serverUpdatedAt = onlineTraining.updated_at;
        const localUpdatedAt = offlineData.training.updated_at;

        const hasModifications =
          serverUpdatedAt &&
          (!localUpdatedAt ||
            new Date(serverUpdatedAt).getTime() > new Date(localUpdatedAt).getTime() ||
            serverUpdatedAt !== localUpdatedAt);

        if (hasModifications) {
          setIsAutoUpdating(true);
          setAutoUpdateMessage('Identificadas alterações no treinamento. Atualizando...');

          try {
            const syncRes = await offlineService.downloadTraining(
              id,
              undefined,
              onlineTraining,
              onlineSteps,
            );
            if (syncRes.success) {
              const freshOffline = await offlineService.getOfflineTraining(id);
              if (freshOffline) {
                setTraining(freshOffline.training);
                setSteps(freshOffline.steps);
                setAutoUpdateMessage('Treinamento atualizado com a versão mais recente!');
                setTimeout(() => setAutoUpdateMessage(null), 3500);
              }
            }
          } catch (syncErr) {
            console.warn('[AutoUpdate] Erro na sincronização automática:', syncErr);
          } finally {
            setIsAutoUpdating(false);
          }
          return;
        }
      }

      // Se não estava baixado offline, exibe a versão online recebida
      if (!wasDownloaded) {
        setTraining(onlineTraining);
        setSteps(onlineSteps);
      }

      // 5. Progresso: carrega se usuário logado e acompanhamento ativo
      if (user && canTrackProgress) {
        try {
          const summary = await progressService.getTrainingProgress(id);
          setCompletedStepIds(summary.steps.filter((s) => s.completed).map((s) => s.stepId));
        } catch {
          // Progresso opcional caso não esteja autenticado ou offline
        }
      }
    } catch (error) {
      console.error('Erro ao carregar dados do treinamento:', error);
      const offlineData = await offlineService.getOfflineTraining(id);
      if (offlineData) {
        setTraining(offlineData.training);
        setSteps(offlineData.steps);
        setIsDownloaded(true);
      }
    } finally {
      setLoading(false);
    }
  }, [id, user, canTrackProgress]);

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

  useEffect(() => {
    let cancelled = false;
    async function resolveUrls() {
      if (training?.cover_url) {
        const cover = await storageService.resolveMediaUrl(training.cover_url);
        if (!cancelled) setResolvedCoverUrl(cover);
      } else if (!cancelled) {
        setResolvedCoverUrl('');
      }

      const nextMedia: Record<string, string> = {};
      await Promise.all(
        steps.flatMap((step) =>
          (step.attachments ?? []).map(async (att) => {
            nextMedia[att.id] = await storageService.resolveMediaUrl(att.file_url);
          }),
        ),
      );
      if (!cancelled) setResolvedMediaUrls(nextMedia);
    }
    resolveUrls();
    return () => {
      cancelled = true;
    };
  }, [training?.cover_url, steps]);

  // Ação: Baixar treinamento completo para uso offline
  const handleDownloadOffline = async () => {
    if (!id) return;
    try {
      setIsDownloading(true);
      setDownloadProgressPct(0);
      setDownloadProgressMsg('Iniciando download...');

      const res = await offlineService.downloadTraining(id, (msg, pct) => {
        setDownloadProgressMsg(msg);
        setDownloadProgressPct(pct);
      });

      if (res.success) {
        setIsDownloaded(true);
        alert('Treinamento, etapas e mídias baixados com sucesso para uso offline!');
        loadData();
      } else {
        alert(res.error || 'Erro ao baixar treinamento.');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Erro inesperado no download offline.');
    } finally {
      setIsDownloading(false);
      setDownloadProgressMsg('');
      setDownloadProgressPct(0);
    }
  };

  // Ação: Gerar e baixar o PDF do treinamento (capa + etapas com fotos)
  const handlePrint = async () => {
    if (!training) return;
    try {
      setIsPrinting(true);
      await pdfService.generateTrainingPdf(training, steps);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Não foi possível gerar o PDF do treinamento.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Ação: Excluir download offline para liberar espaço no aparelho
  const handleDeleteOffline = async () => {
    if (!id) return;
    const confirmDelete = async () => {
      await offlineService.removeOfflineTraining(id);
      setIsDownloaded(false);
      alert('Treinamento offline removido do aparelho.');
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) {
      if (window.confirm('Deseja excluir as etapas e mídias baixadas offline?')) {
        confirmDelete();
      }
    } else {
      confirmDelete();
    }
  };

  // Alterna o status de conclusão da etapa atual
  const toggleCurrentStepCompletion = async () => {
    if (!canTrackProgress) {
      alert('Modo de Visualização: O registro de progresso só é computado quando o treinamento é aberto pela tela de Treinamentos.');
      return;
    }

    const currentStep = steps[currentStepIndex];
    if (!currentStep || !user || !id) return;

    const isCompleted = completedStepIds.includes(currentStep.id);
    const newStatus = !isCompleted;

    // Atualização otimista na tela
    setCompletedStepIds((prev) =>
      newStatus ? [...prev, currentStep.id] : prev.filter((sId) => sId !== currentStep.id)
    );

    try {
      await progressService.setStepCompleted(id, currentStep.id, newStatus);
    } catch (err: unknown) {
      // Rollback em caso de erro
      setCompletedStepIds((prev) =>
        isCompleted ? [...prev, currentStep.id] : prev.filter((sId) => sId !== currentStep.id)
      );
      alert(err instanceof Error ? err.message : 'Erro ao registrar progresso.');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando treinamento...</Text>
      </View>
    );
  }

  if (!training) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Treinamento não encontrado.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const progressPercent =
    steps.length > 0 ? Math.round((completedStepIds.length / steps.length) * 100) : 0;
  const currentStep = steps[currentStepIndex];
  const isCurrentStepCompleted = currentStep ? completedStepIds.includes(currentStep.id) : false;
  const isCreatorOrAdmin =
    user?.role === 'admin' ||
    user?.role === 'creator' ||
    training.created_by === user?.id;

  const handleEditTraining = async () => {
    if (!training) return;
    if (training.status === 'archived') {
      const confirmUnarchive = async () => {
        try {
          const updated = await trainingsService.updateTraining(training.id, { status: 'draft' });
          setTraining(updated);
          router.push(`/training/${training.id}/edit` as never);
        } catch (err: unknown) {
          alert(err instanceof Error ? err.message : 'Erro ao desarquivar treinamento.');
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

    router.push(`/training/${training.id}/edit` as any);
  };

  return (
    <View style={styles.container}>
      <Header />

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.contentContainer}>
        {/* Barra Superior de Navegação */}
        <View style={styles.topNavigation}>
          <TouchableOpacity
            style={styles.backLink}
            onPress={() => (mode === 'study' ? setMode('overview') : router.back())}
          >
            <Ionicons name="arrow-back" size={18} color={colors.text} />
            <Text style={styles.backLinkText}>
              {mode === 'study' ? 'Sair do Modo Estudo' : 'Voltar para Treinamentos'}
            </Text>
          </TouchableOpacity>

          <View style={styles.adminButtons}>
            {/* Imprimir / Baixar PDF (disponível para todos) */}
            <TouchableOpacity
              style={styles.editBtn}
              onPress={handlePrint}
              disabled={isPrinting}
            >
              {isPrinting ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="print-outline" size={16} color={colors.text} />
              )}
              <Text style={styles.editBtnText}>{isPrinting ? 'Gerando PDF...' : 'Imprimir'}</Text>
            </TouchableOpacity>

            {isCreatorOrAdmin && (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => router.push(`/training/${training.id}/share` as any)}
              >
                <Ionicons name="share-social-outline" size={16} color={colors.text} />
                <Text style={styles.editBtnText}>Compartilhar</Text>
              </TouchableOpacity>
            )}

            {isCreatorOrAdmin && (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={handleEditTraining}
              >
                <Ionicons name="create-outline" size={16} color={colors.text} />
                <Text style={styles.editBtnText}>Editar</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Banner de Atualização Automática de Treinamento */}
        {autoUpdateMessage && (
          <View style={styles.autoUpdateBanner}>
            <Ionicons
              name={isAutoUpdating ? 'sync' : 'checkmark-circle'}
              size={16}
              color="#FFF"
            />
            <Text style={styles.autoUpdateBannerText}>{autoUpdateMessage}</Text>
          </View>
        )}

        {/* ---------------- MODO 1: VISÃO GERAL / DETALHES ---------------- */}
        {mode === 'overview' ? (
          <View>
            {/* Banner de Capa */}
            <View style={styles.bannerContainer}>
              {training.cover_url ? (
                <Image
                  source={{ uri: resolvedCoverUrl || training.cover_url }}
                  style={styles.coverImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.coverPlaceholder}>
                  <Text style={styles.coverPlaceholderText}>SMART GUIDE</Text>
                </View>
              )}
            </View>

            {/* Informações Principais */}
            <View style={styles.infoCard}>
              {/* Badges de Categorias */}
              <View style={styles.badgeRow}>
                {(training.categories || []).map((cat) => (
                  <View
                    key={cat.id}
                    style={[styles.categoryBadge, { backgroundColor: cat.color + '20' }]}
                  >
                    <Text style={[styles.categoryBadgeText, { color: cat.color }]}>
                      {cat.name}
                    </Text>
                  </View>
                ))}
              </View>

              <Text style={styles.trainingTitle}>{training.title}</Text>

              {/* Barra de Progresso Geral */}
              <View style={styles.progressSection}>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
                </View>
                <Text style={styles.progressLabel}>
                  {progressPercent}% concluído
                </Text>
              </View>

              {/* Botão de Iniciar Estudo */}
              {steps.length > 0 ? (
                <TouchableOpacity
                  style={styles.startStudyBtn}
                  onPress={() => {
                    // Começa na primeira etapa não concluída
                    const firstIncomplete = steps.findIndex((s) => !completedStepIds.includes(s.id));
                    setCurrentStepIndex(firstIncomplete !== -1 ? firstIncomplete : 0);
                    setMode('study');
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="play" size={18} color={colors.textInverse} />
                  <Text style={styles.startStudyBtnText}>
                    {progressPercent > 0 ? 'Continuar Estudo' : 'Iniciar Treinamento'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.noStepsAlert}>
                  <Text style={styles.noStepsAlertText}>
                    Este treinamento ainda não possui etapas cadastradas.
                  </Text>
                </View>
              )}

              {/* Seção de Download Offline */}
              <View style={styles.offlineBox}>
                <View style={styles.offlineBoxHeader}>
                  <Ionicons
                    name={isDownloaded ? 'cloud-done' : 'cloud-download-outline'}
                    size={22}
                    color={isDownloaded ? colors.success : colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.offlineBoxTitle}>
                      {isDownloaded ? 'Treinamento Disponível Offline' : 'Acesso Offline'}
                    </Text>
                    <Text style={styles.offlineBoxSubtitle}>
                      {isDownloaded
                        ? 'Todas as etapas, fotos e vídeos estão salvos no aparelho para acesso sem internet.'
                        : 'Salve este treinamento para estudar mesmo sem conexão com a internet.'}
                    </Text>
                  </View>
                </View>

                {isDownloading ? (
                  <View style={styles.downloadProgressContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.downloadProgressText}>{downloadProgressMsg}</Text>
                      <View style={styles.downloadProgressBarBg}>
                        <View
                          style={[
                            styles.downloadProgressBarFill,
                            { width: `${downloadProgressPct}%` },
                          ]}
                        />
                      </View>
                    </View>
                    <Text style={styles.downloadProgressPctText}>{downloadProgressPct}%</Text>
                  </View>
                ) : isDownloaded ? (
                  <View style={styles.offlineActionsRow}>
                    <View style={styles.offlineBadgeActive}>
                      <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                      <Text style={styles.offlineBadgeText}>Baixado com sucesso</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeOfflineBtn}
                      onPress={handleDeleteOffline}
                    >
                      <Ionicons name="trash-outline" size={14} color={colors.danger} />
                      <Text style={styles.removeOfflineBtnText}>Excluir download</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.downloadOfflineBtn}
                    onPress={handleDownloadOffline}
                    disabled={isDownloading || steps.length === 0}
                  >
                    <Ionicons name="download-outline" size={16} color={colors.primary} />
                    <Text style={styles.downloadOfflineBtnText}>Baixar Treinamento Offline</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Banner Informativo quando aberto fora da tela de treinamentos */}
              {!canTrackProgress && (
                <View style={styles.previewModeBanner}>
                  <Ionicons name="eye-outline" size={18} color="#D97706" />
                  <Text style={styles.previewModeText}>
                    Modo Pré-visualização: O progresso só é registrado quando aberto pela tela de Treinamentos.
                  </Text>
                </View>
              )}

              {/* Descrição em Texto Rico */}
              <View style={styles.descSection}>
                <Text style={styles.sectionHeading}>Sobre o Treinamento:</Text>
                <RichTextViewer content={training.description} />
              </View>

              {/* Lista das Etapas */}
              <View style={styles.stepsSection}>
                <Text style={styles.sectionHeading}>Etapas do Treinamento:</Text>
                {steps.map((step, idx) => {
                  const isDone = completedStepIds.includes(step.id);
                  return (
                    <TouchableOpacity
                      key={step.id}
                      style={styles.stepItem}
                      onPress={() => {
                        setCurrentStepIndex(idx);
                        setMode('study');
                      }}
                    >
                      <View style={styles.stepItemLeft}>
                        <View style={[styles.stepNumCircle, isDone && styles.stepNumCircleDone]}>
                          {isDone ? (
                            <Ionicons name="checkmark" size={14} color="#FFF" />
                          ) : (
                            <Text style={styles.stepNumText}>{idx + 1}</Text>
                          )}
                        </View>
                        <Text style={[styles.stepTitle, isDone && styles.stepTitleDone]}>
                          {step.title}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        ) : (
          /* ---------------- MODO 2: PLAYER DE ESTUDO ---------------- */
          <View style={styles.studyCard}>
            {/* Cabeçalho do Player */}
            <View style={styles.playerHeader}>
              <View style={styles.stepIndicator}>
                <Text style={styles.stepIndicatorText}>
                  Etapa {currentStepIndex + 1} de {steps.length}
                </Text>
              </View>
              <Text style={styles.currentStepTitle}>{currentStep?.title}</Text>
            </View>

            {/* Conteúdo Rico da Etapa */}
            <View style={styles.stepBody}>
              <RichTextViewer content={currentStep?.content} />
            </View>

            {/* Galeria de Anexos (se houver) */}
            {currentStep?.attachments && currentStep.attachments.length > 0 && (
              <View style={styles.attachmentsSection}>
                <View style={styles.attachmentsHeaderRow}>
                  <Text style={styles.attachmentsTitle}>Materiais e Mídias:</Text>
                  <Text style={styles.attachmentsSubtitle}>
                    Toque na mídia para expandir em tela cheia
                  </Text>
                </View>
                {currentStep.attachments.map((att) => {
                  const mediaUri = resolvedMediaUrls[att.id] || att.file_url;
                  return (
                  <View key={att.id} style={styles.attItem}>
                    {att.file_type === 'video' ? (
                      <View style={styles.videoCard}>
                        {Platform.OS === 'web' ? (
                          <video
                            src={mediaUri}
                            controls
                            style={{
                              width: '100%',
                              maxHeight: 400,
                              borderRadius: 6,
                              backgroundColor: '#0F172A',
                            }}
                          />
                        ) : (
                          <NativeVideoPlayer
                            uri={mediaUri}
                            style={{
                              width: '100%',
                              height: 240,
                              borderRadius: 6,
                              backgroundColor: '#0F172A',
                            }}
                          />
                        )}
                        <TouchableOpacity
                          style={styles.expandVideoBtn}
                          onPress={() => setExpandedMedia(att)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="expand-outline" size={14} color={colors.text} />
                          <Text style={styles.expandVideoBtnText}>Expandir em Popup</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.mediaCardTouchable}
                        onPress={() => setExpandedMedia(att)}
                        activeOpacity={0.85}
                      >
                        <Image
                          source={{ uri: mediaUri }}
                          style={styles.attImage}
                          resizeMode="contain"
                          onError={(e) =>
                            console.warn('Erro ao carregar imagem:', mediaUri, e.nativeEvent.error)
                          }
                        />
                        <View style={styles.expandBadge}>
                          <Ionicons name="scan-outline" size={13} color="#FFF" />
                          <Text style={styles.expandBadgeText}>Clique para ampliar</Text>
                        </View>
                      </TouchableOpacity>
                    )}
                    <View style={styles.attMetaRow}>
                      <Ionicons
                        name={att.file_type === 'video' ? 'videocam-outline' : 'image-outline'}
                        size={14}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.attFileName}>{att.file_name}</Text>
                    </View>
                  </View>
                  );
                })}
              </View>
            )}

            {/* Aviso de Pré-visualização no Modo Estudo */}
            {!canTrackProgress && (
              <View style={styles.previewModeBanner}>
                <Ionicons name="information-circle-outline" size={18} color="#D97706" />
                <Text style={styles.previewModeText}>
                  Modo Pré-visualização: O progresso só é registrado quando aberto pela tela de Treinamentos.
                </Text>
              </View>
            )}

            {/* Ação de Concluir Etapa */}
            <TouchableOpacity
              style={[
                styles.completeStepBtn,
                isCurrentStepCompleted && styles.completeStepBtnDone,
                !canTrackProgress && styles.completeStepBtnDisabled,
              ]}
              onPress={toggleCurrentStepCompletion}
            >
              <Ionicons
                name={isCurrentStepCompleted ? 'checkbox' : 'square-outline'}
                size={20}
                color={
                  !canTrackProgress
                    ? colors.textMuted
                    : isCurrentStepCompleted
                    ? colors.success
                    : colors.text
                }
              />
              <Text
                style={[
                  styles.completeStepText,
                  isCurrentStepCompleted && styles.completeStepTextDone,
                  !canTrackProgress && { color: colors.textMuted },
                ]}
              >
                {!canTrackProgress
                  ? 'Progresso desativado em pré-visualização'
                  : isCurrentStepCompleted
                  ? 'Etapa Concluída'
                  : 'Marcar etapa como concluída'}
              </Text>
            </TouchableOpacity>

            {/* Navegação entre Etapas (Anterior / Próxima) */}
            <View style={styles.navButtonsRow}>
              <TouchableOpacity
                style={[styles.navStepBtn, currentStepIndex === 0 && styles.navStepBtnDisabled]}
                disabled={currentStepIndex === 0}
                onPress={() => setCurrentStepIndex((prev) => Math.max(0, prev - 1))}
              >
                <Ionicons name="arrow-back" size={16} color={colors.text} />
                <Text style={styles.navStepBtnText}>Etapa Anterior</Text>
              </TouchableOpacity>

              {currentStepIndex < steps.length - 1 ? (
                <TouchableOpacity
                  style={[styles.navStepBtn, styles.navStepBtnPrimary]}
                  onPress={() =>
                    setCurrentStepIndex((prev) => Math.min(steps.length - 1, prev + 1))
                  }
                >
                  <Text style={styles.navStepBtnPrimaryText}>Próxima Etapa</Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.textInverse} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.navStepBtn, styles.navStepBtnFinish]}
                  onPress={() => setMode('overview')}
                >
                  <Text style={styles.navStepBtnPrimaryText}>Finalizar Treinamento ✓</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Modal Lightbox Popup para Mídias em Alta Resolução */}
      <Modal
        visible={!!expandedMedia}
        transparent
        animationType="fade"
        onRequestClose={() => setExpandedMedia(null)}
      >
        <View style={styles.lightboxOverlay}>
          {/* Barra Superior do Lightbox */}
          <View style={styles.lightboxHeader}>
            <View style={styles.lightboxTitleInfo}>
              <Ionicons
                name={expandedMedia?.file_type === 'video' ? 'videocam' : 'image'}
                size={20}
                color="#FFF"
              />
              <Text style={styles.lightboxTitle} numberOfLines={1}>
                {expandedMedia?.file_name}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.lightboxCloseBtn}
              onPress={() => setExpandedMedia(null)}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>

          {/* Área Central com Mídia em Alta Escala */}
          <TouchableOpacity
            style={styles.lightboxBackdropTouchable}
            activeOpacity={1}
            onPress={() => setExpandedMedia(null)}
          >
            <View style={styles.lightboxContent}>
              {expandedMedia?.file_type === 'video' ? (
                Platform.OS === 'web' ? (
                  <video
                    src={resolvedMediaUrls[expandedMedia.id] || expandedMedia.file_url}
                    controls
                    autoPlay
                    style={{
                      maxWidth: '94vw',
                      maxHeight: '82vh',
                      borderRadius: 8,
                      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
                      backgroundColor: '#000',
                    }}
                  />
                ) : (
                  <NativeVideoPlayer
                    uri={resolvedMediaUrls[expandedMedia.id] || expandedMedia.file_url}
                    autoPlay
                    style={{
                      width: '92%',
                      height: 360,
                      borderRadius: 8,
                      backgroundColor: '#000',
                    }}
                  />
                )
              ) : (
                <Image
                  source={{
                    uri: expandedMedia
                      ? resolvedMediaUrls[expandedMedia.id] || expandedMedia.file_url
                      : undefined,
                  }}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                />
              )}
            </View>
          </TouchableOpacity>

          <Text style={styles.lightboxHint}>
            Toque no botão fechar (X) ou fora da mídia para fechar o popup
          </Text>
        </View>
      </Modal>

      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  errorText: {
    fontSize: 16,
    color: colors.danger,
    marginBottom: 12,
  },
  scrollArea: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
  },
  topNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 8,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backLinkText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  adminButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 3,
    backgroundColor: colors.surface,
  },
  editBtnText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  bannerContainer: {
    height: 200,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#EEEEEE',
    marginBottom: 16,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPlaceholderText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 20,
    letterSpacing: 2,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 24,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
  },
  categoryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  trainingTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
    lineHeight: 28,
    marginBottom: 16,
  },
  progressSection: {
    marginBottom: 20,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: colors.borderLight,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  progressLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  startStudyBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 3,
    gap: 8,
    marginBottom: 24,
  },
  startStudyBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 15,
  },
  noStepsAlert: {
    backgroundColor: colors.warning + '20',
    padding: 12,
    borderRadius: 4,
    marginBottom: 20,
  },
  noStepsAlertText: {
    color: colors.text,
    fontSize: 13,
  },
  descSection: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 16,
    marginBottom: 24,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 10,
  },
  stepsSection: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 16,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 3,
    marginBottom: 8,
    backgroundColor: '#FAFAFA',
  },
  stepItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  stepNumCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumCircleDone: {
    backgroundColor: colors.success,
  },
  stepNumText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.text,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
  stepTitleDone: {
    color: colors.textSecondary,
  },
  studyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 24,
  },
  playerHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    paddingBottom: 16,
    marginBottom: 20,
  },
  stepIndicator: {
    backgroundColor: colors.primaryLight,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    marginBottom: 8,
  },
  stepIndicatorText: {
    color: colors.primaryHover,
    fontSize: 12,
    fontWeight: 'bold',
  },
  currentStepTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    lineHeight: 26,
  },
  stepBody: {
    minHeight: 200,
    marginBottom: 24,
  },
  attachmentsSection: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 16,
    marginBottom: 20,
  },
  attachmentsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 6,
  },
  attachmentsTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.text,
  },
  attachmentsSubtitle: {
    fontSize: 12,
    color: colors.primaryHover,
    fontWeight: '500',
  },
  attItem: {
    marginBottom: 16,
  },
  videoCard: {
    backgroundColor: '#0F172A',
    borderRadius: 6,
    padding: 6,
    marginBottom: 6,
  },
  expandVideoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: colors.border,
  },
  expandVideoBtnText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  mediaCardTouchable: {
    position: 'relative',
    width: '100%',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: '#F8FAFC',
    marginBottom: 6,
  },
  attImage: {
    width: '100%',
    height: 340,
    backgroundColor: '#F8FAFC',
  },
  expandBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  expandBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  attMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  attFileName: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  completeStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FAFAFA',
    marginBottom: 24,
  },
  completeStepBtnDone: {
    backgroundColor: colors.successLight,
    borderColor: colors.success,
  },
  completeStepText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  completeStepTextDone: {
    color: colors.success,
  },
  navButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 16,
  },
  navStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 3,
  },
  navStepBtnDisabled: {
    opacity: 0.4,
  },
  navStepBtnText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  navStepBtnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  navStepBtnPrimaryText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 13,
  },
  navStepBtnFinish: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  backBtn: {
    marginTop: 12,
    padding: 10,
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  backBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  videoPlaceholder: {
    backgroundColor: '#000',
    height: 200,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  videoPlaceholderText: {
    color: '#FFF',
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 15, 29, 0.95)',
    justifyContent: 'space-between',
    padding: 16,
  },
  lightboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  lightboxTitleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 16,
  },
  lightboxTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  lightboxCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxBackdropTouchable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  lightboxContent: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
    maxWidth: 1200,
    maxHeight: 800,
  },
  lightboxHint: {
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    paddingTop: 8,
  },
  // Box Offline
  offlineBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  offlineBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  offlineBoxTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  offlineBoxSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  downloadOfflineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  downloadOfflineBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  downloadProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  downloadProgressText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  downloadProgressBarBg: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  downloadProgressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  downloadProgressPctText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    minWidth: 36,
    textAlign: 'right',
  },
  offlineActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    flexWrap: 'wrap',
    gap: 8,
  },
  offlineBadgeActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  offlineBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#15803D',
  },
  removeOfflineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  removeOfflineBtnText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '500',
  },
  // Banner de Pré-visualização
  previewModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 6,
    padding: 12,
    marginTop: 14,
    marginBottom: 10,
  },
  previewModeText: {
    flex: 1,
    fontSize: 12,
    color: '#92400E',
    lineHeight: 16,
    fontWeight: '500',
  },
  completeStepBtnDisabled: {
    opacity: 0.5,
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  autoUpdateBanner: {
    backgroundColor: '#0F766E',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 16,
  },
  autoUpdateBannerText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
