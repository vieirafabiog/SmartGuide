// ==============================================================================
// Serviço de Armazenamento e Treinamentos Offline (Offline Service)
// Permite baixar dados, etapas e mídias (fotos/vídeos) do Supabase Storage
// para execução sem conexão à internet.
// ==============================================================================

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Training, TrainingStep, StepAttachment } from '../types/database';
import { trainingsService } from './trainings.service';
import { stepsService } from './steps.service';

const OFFLINE_INDEX_KEY = '@smartguide_offline_trainings_index';
const OFFLINE_TRAINING_PREFIX = '@smartguide_offline_training_';

export interface OfflineAttachmentMap {
  [attachmentId: string]: string; // URL original -> URI local salvo no storage
}

export interface OfflineTrainingData {
  training: Training;
  steps: TrainingStep[];
  downloadedAt: string;
  totalSize: number; // bytes
  mediaMap: OfflineAttachmentMap; // attachmentId -> localUri
  coverLocalUri?: string;
}

export const offlineService = {
  // Retorna se um treinamento já foi baixado no dispositivo
  async isTrainingDownloaded(trainingId: string): Promise<boolean> {
    try {
      const data = await AsyncStorage.getItem(`${OFFLINE_TRAINING_PREFIX}${trainingId}`);
      return !!data;
    } catch {
      return false;
    }
  },

  // Retorna os dados completos do treinamento baixado offline
  async getOfflineTraining(trainingId: string): Promise<OfflineTrainingData | null> {
    try {
      const json = await AsyncStorage.getItem(`${OFFLINE_TRAINING_PREFIX}${trainingId}`);
      if (!json) return null;
      return JSON.parse(json) as OfflineTrainingData;
    } catch (err) {
      console.error('Erro ao ler treinamento offline:', err);
      return null;
    }
  },

  // Retorna a lista resumida de todos os treinamentos baixados
  async getAllOfflineTrainings(): Promise<Training[]> {
    try {
      const indexJson = await AsyncStorage.getItem(OFFLINE_INDEX_KEY);
      if (!indexJson) return [];
      const ids: string[] = JSON.parse(indexJson);
      const trainings: Training[] = [];

      for (const id of ids) {
        const item = await this.getOfflineTraining(id);
        if (item?.training) {
          trainings.push(item.training);
        }
      }
      return trainings;
    } catch (err) {
      console.error('Erro ao listar treinamentos offline:', err);
      return [];
    }
  },

  // Verifica se o treinamento baixado localmente possui data anterior à versão do servidor
  async isTrainingOutdated(trainingId: string, serverUpdatedAt?: string): Promise<boolean> {
    if (!serverUpdatedAt) return false;
    const offline = await this.getOfflineTraining(trainingId);
    if (!offline) return false;
    if (!offline.training?.updated_at) return true;
    return (
      new Date(serverUpdatedAt).getTime() > new Date(offline.training.updated_at).getTime() ||
      serverUpdatedAt !== offline.training.updated_at
    );
  },

  // Baixa o treinamento, todas as suas etapas e todas as mídias (fotos e vídeos)
  async downloadTraining(
    trainingId: string,
    onProgress?: (message: string, percent: number) => void,
    prefetchTraining?: Training | null,
    prefetchSteps?: TrainingStep[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      onProgress?.('Carregando informações do treinamento...', 5);

      // 1. Obtém dados do treinamento e das etapas (usa prefetch se disponível para poupar egress)
      let training = prefetchTraining;
      let steps = prefetchSteps;

      if (!training || !steps) {
        const [t, s] = await Promise.all([
          trainingsService.getTrainingById(trainingId),
          stepsService.getStepsByTrainingId(trainingId),
        ]);
        training = t;
        steps = s;
      }

      if (!training) {
        return { success: false, error: 'Treinamento não encontrado para download.' };
      }

      onProgress?.('Estruturando dados locais...', 15);

      const mediaMap: OfflineAttachmentMap = {};
      let totalBytes = 0;
      let coverLocalUri: string | undefined = undefined;

      const isNative = Platform.OS !== 'web' && !!FileSystem.documentDirectory;
      const baseDir = isNative
        ? `${FileSystem.documentDirectory}offline_trainings/${trainingId}/`
        : null;

      if (isNative && baseDir) {
        // Garante que o diretório específico do treinamento exista
        await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
      }

      // 2. Baixa a capa do treinamento, se houver
      if (training.cover_url) {
        onProgress?.('Baixando imagem de capa...', 20);
        if (isNative && baseDir) {
          try {
            const ext = training.cover_url.split('.').pop()?.split('?')[0] || 'jpg';
            const localCoverFile = `${baseDir}cover_${Date.now()}.${ext}`;
            const downloadRes = await FileSystem.downloadAsync(training.cover_url, localCoverFile);
            if (downloadRes.status === 200) {
              coverLocalUri = downloadRes.uri;
            }
          } catch (e) {
            console.warn('Não foi possível baixar capa para offline:', e);
          }
        }
      }

      // 3. Contabiliza total de anexos de mídia (imagens e vídeos)
      const allAttachments: { stepId: string; att: StepAttachment }[] = [];
      steps.forEach((step) => {
        (step.attachments || []).forEach((att) => {
          if (att.file_url) {
            allAttachments.push({ stepId: step.id, att });
          }
        });
      });

      const totalMedia = allAttachments.length;

      // 4. Baixa cada arquivo de mídia para o storage do dispositivo
      for (let i = 0; i < totalMedia; i++) {
        const item = allAttachments[i];
        const att = item.att;
        const progressPct = Math.round(25 + ((i + 1) / totalMedia) * 70);

        onProgress?.(
          `Baixando mídia ${i + 1} de ${totalMedia} (${att.file_type === 'video' ? 'Vídeo' : 'Foto'})...`,
          progressPct
        );

        if (isNative && baseDir && att.file_url) {
          try {
            const ext = att.file_name?.split('.').pop() || (att.file_type === 'video' ? 'mp4' : 'jpg');
            const sanitizedName = `media_${att.id}_${Date.now()}.${ext}`;
            const targetUri = `${baseDir}${sanitizedName}`;

            const res = await FileSystem.downloadAsync(att.file_url, targetUri);
            if (res.status === 200) {
              mediaMap[att.id] = res.uri;
              if (att.file_size) totalBytes += att.file_size;
            }
          } catch (attErr) {
            console.warn(`Erro ao baixar anexo ${att.id}:`, attErr);
          }
        } else if (att.file_url) {
          // Na Web mantém cache local da URL
          mediaMap[att.id] = att.file_url;
        }
      }

      // 5. Atualiza o objeto do treinamento e etapas com os caminhos locais
      const offlineTraining: Training = {
        ...training,
        cover_url: coverLocalUri || training.cover_url,
      };

      const offlineSteps: TrainingStep[] = steps.map((step) => ({
        ...step,
        attachments: (step.attachments || []).map((att) => ({
          ...att,
          file_url: mediaMap[att.id] || att.file_url,
        })),
      }));

      // 6. Salva os dados no AsyncStorage
      const offlinePayload: OfflineTrainingData = {
        training: offlineTraining,
        steps: offlineSteps,
        downloadedAt: new Date().toISOString(),
        totalSize: totalBytes,
        mediaMap,
        coverLocalUri,
      };

      await AsyncStorage.setItem(
        `${OFFLINE_TRAINING_PREFIX}${trainingId}`,
        JSON.stringify(offlinePayload)
      );

      // 7. Atualiza o índice de treinamentos baixados
      const existingIndex = await AsyncStorage.getItem(OFFLINE_INDEX_KEY);
      const ids: string[] = existingIndex ? JSON.parse(existingIndex) : [];
      if (!ids.includes(trainingId)) {
        ids.push(trainingId);
        await AsyncStorage.setItem(OFFLINE_INDEX_KEY, JSON.stringify(ids));
      }

      onProgress?.('Download concluído com sucesso!', 100);
      return { success: true };
    } catch (err: any) {
      console.error('Erro no download offline:', err);
      return { success: false, error: err.message || 'Falha ao baixar treinamento offline.' };
    }
  },

  // Remove um treinamento do armazenamento offline e limpa os arquivos locais
  async removeOfflineTraining(trainingId: string): Promise<void> {
    try {
      // 1. Se estiver no nativo, apaga os arquivos baixados no diretório
      if (Platform.OS !== 'web' && FileSystem.documentDirectory) {
        const baseDir = `${FileSystem.documentDirectory}offline_trainings/${trainingId}/`;
        const dirInfo = await FileSystem.getInfoAsync(baseDir);
        if (dirInfo.exists) {
          await FileSystem.deleteAsync(baseDir, { idempotent: true });
        }
      }

      // 2. Remove do AsyncStorage
      await AsyncStorage.removeItem(`${OFFLINE_TRAINING_PREFIX}${trainingId}`);

      // 3. Atualiza índice
      const existingIndex = await AsyncStorage.getItem(OFFLINE_INDEX_KEY);
      if (existingIndex) {
        const ids: string[] = JSON.parse(existingIndex);
        const updated = ids.filter((id) => id !== trainingId);
        await AsyncStorage.setItem(OFFLINE_INDEX_KEY, JSON.stringify(updated));
      }
    } catch (err) {
      console.error('Erro ao remover treinamento offline:', err);
    }
  },
};
