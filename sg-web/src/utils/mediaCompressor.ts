// ==============================================================================
// Utilitário de Compressão e Validação de Mídias (Media Compressor & Validator)
// Aplica a maior compressão possível nativa para imagens (WebP com Canvas)
// e valida estritamente formatos de imagem e vídeo permitidos no treinamento.
// ==============================================================================

export const ALLOWED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
  '.heic',
  '.heif',
];

export const ALLOWED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.m4v',
  '.avi',
  '.ogv',
];

export interface MediaValidationResult {
  valid: boolean;
  fileType: 'image' | 'video' | null;
  error?: string;
}

/**
 * Valida se o arquivo é exclusivamente uma imagem ou vídeo suportado.
 * Impede envio de PDFs, executáveis, documentos ou arquivos desconhecidos.
 */
export function validateMediaFile(
  file: File | Blob,
  fileName: string,
  allowedCategory: 'image' | 'video' | 'any' = 'any'
): MediaValidationResult {
  const mime = (file.type || '').toLowerCase();
  const lowerName = fileName.toLowerCase();
  const ext =
    lowerName.lastIndexOf('.') !== -1 ? lowerName.substring(lowerName.lastIndexOf('.')) : '';

  const isImageMime = mime.startsWith('image/');
  const isImageExt = ALLOWED_IMAGE_EXTENSIONS.includes(ext);
  const isImage = isImageMime || isImageExt;

  const isVideoMime = mime.startsWith('video/');
  const isVideoExt = ALLOWED_VIDEO_EXTENSIONS.includes(ext);
  const isVideo = isVideoMime || isVideoExt;

  // Validação restrita para capa (apenas imagem)
  if (allowedCategory === 'image') {
    if (!isImage) {
      return {
        valid: false,
        fileType: null,
        error: `O arquivo "${fileName}" não é uma imagem válida. Apenas formatos como JPG, PNG, WEBP ou GIF são aceitos para a capa do treinamento.`,
      };
    }
    return { valid: true, fileType: 'image' };
  }

  // Validação restrita para vídeo
  if (allowedCategory === 'video') {
    if (!isVideo) {
      return {
        valid: false,
        fileType: null,
        error: `O arquivo "${fileName}" não é um vídeo válido. Apenas formatos como MP4, WEBM ou MOV são aceitos.`,
      };
    }
    return { valid: true, fileType: 'video' };
  }

  // Validação geral para etapas do treinamento (apenas imagens e vídeos)
  if (!isImage && !isVideo) {
    return {
      valid: false,
      fileType: null,
      error: `O arquivo "${fileName}" não é suportado. Apenas imagens (JPG, PNG, WEBP) e vídeos (MP4, WEBM, MOV) são permitidos para os treinamentos.`,
    };
  }

  // Limite de segurança para vídeos (50 MB)
  const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
  if (isVideo && file.size > MAX_VIDEO_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      fileType: 'video',
      error: `O vídeo "${fileName}" possui ${sizeMB} MB. O limite máximo permitido para vídeos é de 50 MB para economizar espaço de armazenamento.`,
    };
  }

  // Limite de segurança para imagens brutas pré-compressão (25 MB)
  const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
  if (isImage && file.size > MAX_IMAGE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      fileType: 'image',
      error: `A imagem "${fileName}" possui ${sizeMB} MB. O limite máximo permitido é de 25 MB.`,
    };
  }

  return {
    valid: true,
    fileType: isImage ? 'image' : 'video',
  };
}

export interface CompressionResult {
  file: File | Blob;
  fileName: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
}

/**
 * Comprime uma imagem nativamente no navegador utilizando HTML5 Canvas e formato WebP.
 * Proporciona a maior taxa de compressão possível (normalmente 80% a 95% de redução),
 * sem degradação visual perceptível para o usuário final.
 */
export async function compressImage(
  file: File | Blob,
  fileName: string,
  options?: {
    maxDimension?: number;
    quality?: number;
  }
): Promise<CompressionResult> {
  const maxDimension = options?.maxDimension || 1600;
  const quality = options?.quality !== undefined ? options?.quality : 0.68;
  const originalSize = file.size || 0;

  // Se não estiver em ambiente de navegador com suporte a DOM/Canvas, retorna o original
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { file, fileName, originalSize, compressedSize: originalSize, ratio: 0 };
  }

  const mime = (file.type || '').toLowerCase();
  const lowerName = fileName.toLowerCase();

  // Preserva SVGs e GIFs animados (não rasterizar vetores nem remover frames de animação)
  if (
    mime.includes('svg') ||
    lowerName.endsWith('.svg') ||
    mime.includes('gif') ||
    lowerName.endsWith('.gif')
  ) {
    return { file, fileName, originalSize, compressedSize: originalSize, ratio: 0 };
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Falha ao decodificar os pixels da imagem'));
      img.src = objectUrl;
    });

    URL.revokeObjectURL(objectUrl);

    let { width, height } = img;
    if (width === 0 || height === 0) {
      return { file, fileName, originalSize, compressedSize: originalSize, ratio: 0 };
    }

    // Redimensionamento proporcional mantendo a proporção original (aspect ratio)
    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { file, fileName, originalSize, compressedSize: originalSize, ratio: 0 };
    }

    // Renderiza com alta qualidade de interpolação
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    // Converte para WebP (formato com a maior compressão suportada pelos navegadores)
    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 0) {
            resolve(blob);
          } else {
            // Fallback para JPEG com compressão caso o navegador não suporte toBlob em WebP
            canvas.toBlob((jpegBlob) => resolve(jpegBlob), 'image/jpeg', quality);
          }
        },
        'image/webp',
        quality
      );
    });

    if (!compressedBlob || compressedBlob.size === 0) {
      return { file, fileName, originalSize, compressedSize: originalSize, ratio: 0 };
    }

    // Se a compressão ficou maior que o original (ex: ícone minúsculo já ultra otimizado), mantém o original
    if (compressedBlob.size >= originalSize && originalSize > 0) {
      return { file, fileName, originalSize, compressedSize: originalSize, ratio: 0 };
    }

    const isWebp = compressedBlob.type.includes('webp');
    const newExt = isWebp ? '.webp' : '.jpg';
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    const newFileName = `${baseName}${newExt}`;

    let resultFile: File | Blob = compressedBlob;
    if (typeof File !== 'undefined') {
      try {
        resultFile = new File([compressedBlob], newFileName, {
          type: compressedBlob.type,
          lastModified: Date.now(),
        });
      } catch {
        resultFile = compressedBlob;
      }
    }

    const compressedSize = compressedBlob.size;
    const savedBytes = originalSize - compressedSize;
    const ratio = originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

    return {
      file: resultFile,
      fileName: newFileName,
      originalSize,
      compressedSize,
      ratio,
    };
  } catch (error) {
    console.warn('[mediaCompressor] Erro ao comprimir imagem, utilizando arquivo original:', error);
    return { file, fileName, originalSize, compressedSize: originalSize, ratio: 0 };
  }
}
