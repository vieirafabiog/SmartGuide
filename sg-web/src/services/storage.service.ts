// ==============================================================================
// Serviço de Armazenamento (Storage Service)
// Gerencia uploads de imagens e vídeos no Supabase Storage
// ==============================================================================

import { supabase } from './supabase';
import { AttachmentType } from '../types/database';
import { validateMediaFile, compressImage } from '../utils/mediaCompressor';

export interface UploadedFileResult {
  url: string;
  fileName: string;
  fileType: AttachmentType;
  fileSize: number;
}

export const storageService = {
  // Faz o upload de um arquivo para um bucket específico do Supabase com compressão e validação
  async uploadFile(
    bucket: 'training-covers' | 'step-attachments',
    file: File | Blob,
    fileName: string,
    folderPath: string = ''
  ): Promise<{ result: UploadedFileResult | null; error: string | null }> {
    // 1. Validação estrita: aceita apenas imagens e vídeos (e capa aceita exclusivamente imagem)
    const allowedCategory = bucket === 'training-covers' ? 'image' : 'any';
    const validation = validateMediaFile(file, fileName, allowedCategory);
    if (!validation.valid || !validation.fileType) {
      return { result: null, error: validation.error || 'Arquivo não permitido.' };
    }

    const fileType = validation.fileType;
    let finalFile = file;
    let finalFileName = fileName;

    // 2. Compressão máxima para imagens (WebP via Canvas nativo)
    if (fileType === 'image') {
      try {
        const compressed = await compressImage(file, fileName, {
          maxDimension: 1600,
          quality: 0.68,
        });
        finalFile = compressed.file;
        finalFileName = compressed.fileName;
        if (compressed.ratio > 0) {
          console.log(
            `[Storage] Imagem otimizada: "${fileName}" -> "${finalFileName}" (${(compressed.originalSize / 1024).toFixed(0)}KB -> ${(compressed.compressedSize / 1024).toFixed(0)}KB, economia de ${compressed.ratio}%)`
          );
        }
      } catch (compErr) {
        console.warn('[Storage] Falha na compressão, enviando arquivo original:', compErr);
      }
    }

    const cleanFileName = finalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = folderPath
      ? `${folderPath}/${Date.now()}_${cleanFileName}`
      : `${Date.now()}_${cleanFileName}`;

    try {
      const { data, error } = await supabase.storage.from(bucket).upload(fullPath, finalFile, {
        cacheControl: '31536000',
        contentType: finalFile.type || (fileType === 'image' ? 'image/webp' : 'video/mp4'),
        upsert: true,
      });

      if (error || !data) {
        return { result: null, error: error?.message || 'Erro ao enviar o arquivo.' };
      }

      // Obtém a URL pública do arquivo
      const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(data.path);

      return {
        result: {
          url: publicUrlData.publicUrl,
          fileName: cleanFileName,
          fileType,
          fileSize: finalFile.size || 0,
        },
        error: null,
      };
    } catch (err: any) {
      return { result: null, error: err.message || 'Erro inesperado no upload.' };
    }
  },

  // Faz upload da capa do treinamento
  async uploadTrainingCover(
    file: File | Blob,
    fileName: string,
    companyId: string = 'global'
  ): Promise<{ url: string | null; error: string | null }> {
    const { result, error } = await this.uploadFile('training-covers', file, fileName, companyId);
    if (error || !result) {
      return { url: null, error };
    }
    return { url: result.url, error: null };
  },

  // Faz upload de um anexo da etapa (imagem ou vídeo)
  async uploadStepMedia(
    file: File | Blob,
    fileName: string,
    trainingId: string,
    stepId: string
  ): Promise<{ result: UploadedFileResult | null; error: string | null }> {
    return await this.uploadFile(
      'step-attachments',
      file,
      fileName,
      `${trainingId}/${stepId}`
    );
  },

  // Extrai o caminho interno de um arquivo no storage a partir de sua URL pública
  extractPathFromUrl(url: string, bucket: 'training-covers' | 'step-attachments'): string | null {
    if (!url) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx !== -1) {
      return decodeURIComponent(url.substring(idx + marker.length));
    }
    // Suporte caso a URL seja autenticada
    const markerAuth = `/storage/v1/object/authenticated/${bucket}/`;
    const idxAuth = url.indexOf(markerAuth);
    if (idxAuth !== -1) {
      return decodeURIComponent(url.substring(idxAuth + markerAuth.length));
    }
    return null;
  },

  // Exclui um arquivo físico do Storage
  async deleteFile(
    bucket: 'training-covers' | 'step-attachments',
    pathOrUrl: string
  ): Promise<{ success: boolean; error: string | null }> {
    if (!pathOrUrl) {
      return { success: true, error: null };
    }

    try {
      let path = pathOrUrl;
      if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
        const extracted = this.extractPathFromUrl(pathOrUrl, bucket);
        if (!extracted) {
          // Arquivo externo (ex: unsplash demo)
          return { success: true, error: null };
        }
        path = extracted;
      }

      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) {
        console.warn(`Erro ao excluir arquivo no storage (${bucket}/${path}):`, error.message);
        return { success: false, error: error.message };
      }
      return { success: true, error: null };
    } catch (err: any) {
      console.warn(`Exceção ao excluir arquivo no storage (${bucket}):`, err);
      return { success: false, error: err.message || 'Erro ao excluir arquivo.' };
    }
  },

  // Exclui múltiplos arquivos do Storage
  async deleteFiles(
    bucket: 'training-covers' | 'step-attachments',
    pathsOrUrls: string[]
  ): Promise<{ success: boolean; error: string | null }> {
    if (!pathsOrUrls || pathsOrUrls.length === 0) {
      return { success: true, error: null };
    }

    try {
      const paths = pathsOrUrls
        .map((p) =>
          p.startsWith('http://') || p.startsWith('https://')
            ? this.extractPathFromUrl(p, bucket)
            : p
        )
        .filter((p): p is string => Boolean(p));

      if (paths.length === 0) {
        return { success: true, error: null };
      }

      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) {
        console.warn(`Erro ao excluir arquivos no storage (${bucket}):`, error.message);
        return { success: false, error: error.message };
      }
      return { success: true, error: null };
    } catch (err: any) {
      console.warn(`Exceção ao excluir arquivos no storage (${bucket}):`, err);
      return { success: false, error: err.message || 'Erro ao excluir arquivos.' };
    }
  },
};
