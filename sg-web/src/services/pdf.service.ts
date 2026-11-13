// ==============================================================================
// Serviço de PDF do Treinamento (PDF Service)
// Gera um PDF de alta qualidade com:
// - Folha de capa com foto, autor, datas de criação e modificação
// - Página de Sumário / Índice detalhado com números de página
// - Mini cabeçalho do SmartGuide no topo de cada folha subsequente
// - Numeração de página em cada folha (Página X de Y)
// - Etapas com texto e fotos (vídeos ignorados automaticamente)
// ==============================================================================

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { Training, TrainingStep } from '../types/database';

const LOGO_MODULE = require('../../assets/icon.png');

// Tamanho de página A4 em pontos (72 PPI)
const A4 = { width: 595, height: 842 };

// ------------------------------------------------------------------------------
// Utilitários de Formatação e Escrita
// ------------------------------------------------------------------------------

// Escapa texto simples para inserir com segurança no HTML
function escapeHtml(text: string = ''): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Gera um nome de arquivo seguro a partir do título
function toFileName(title: string): string {
  const clean = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return clean || 'treinamento';
}

// Formata data e hora no padrão brasileiro (DD/MM/AAAA às HH:mm)
function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} às ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

// Converte URLs locais (file://) para Base64 no mobile para renderização garantida no PDF
async function toPrintableSrc(uri: string): Promise<string> {
  if (!uri) return '';
  if (Platform.OS === 'web' || !uri.startsWith('file://')) return uri;
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const ext = uri.split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  } catch {
    return uri;
  }
}

// Logo do SmartGuide (URL absoluta na web, base64 no mobile)
async function getLogoSrc(): Promise<string> {
  try {
    const asset = Asset.fromModule(LOGO_MODULE);
    if (Platform.OS === 'web') {
      return new URL(asset.uri, window.location.href).href;
    }
    await asset.downloadAsync();
    return await toPrintableSrc(asset.localUri || asset.uri);
  } catch {
    return '';
  }
}

// Nome da empresa do treinamento (com limite de tempo para não travar sem internet)
async function getCompanyName(companyId?: string | null): Promise<string> {
  if (!companyId) return '';
  const query = supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle()
    .then(({ data }) => data?.name || '');
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000));
  try {
    return await Promise.race([query, timeout]);
  } catch {
    return '';
  }
}

// Nome do criador do treinamento (com timeout de segurança)
async function getCreatorName(userId?: string | null): Promise<string> {
  if (!userId) return '';
  const query = supabase
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .maybeSingle()
    .then(({ data }) => data?.name || '');
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000));
  try {
    return await Promise.race([query, timeout]);
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------------------
// Montagem do HTML e Estilização
// ------------------------------------------------------------------------------

interface PdfContent {
  training: Training;
  steps: TrainingStep[];
  companyName: string;
  creatorName: string;
  logoSrc: string;
  coverImageSrc?: string;
}

const PDF_STYLES = `
  @page {
    size: A4;
    margin: 14mm 16mm;
  }
  * {
    box-sizing: border-box;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1e293b;
    margin: 0;
    padding: 0;
    font-size: 11pt;
    line-height: 1.5;
    background: #ffffff;
  }
  .page-break {
    page-break-before: always;
    break-before: page;
  }

  /* Estrutura padrão de página para Sumário e Etapas */
  .sheet-page {
    min-height: 250mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    box-sizing: border-box;
  }
  .sheet-body {
    flex: 1;
  }

  /* Mini cabeçalho repetido no topo de cada folha após a capa */
  .mini-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1.5px solid #e2e8f0;
    padding-bottom: 8px;
    margin-bottom: 18px;
    font-size: 8.5pt;
  }
  .mini-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 68%;
    overflow: hidden;
  }
  .mini-logo {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
  .mini-brand {
    font-weight: 800;
    color: #d97706;
    letter-spacing: 1px;
    font-size: 8.5pt;
    white-space: nowrap;
  }
  .mini-sep {
    color: #cbd5e1;
  }
  .mini-title {
    color: #475569;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini-header-right {
    text-align: right;
    max-width: 32%;
  }
  .mini-company {
    color: #64748b;
    font-weight: 600;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Rodapé com numeração de página */
  .page-footer {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8pt;
    color: #94a3b8;
  }
  .page-footer-right {
    font-weight: 700;
    color: #64748b;
  }

  /* ==================== CAPA ==================== */
  .cover-page {
    min-height: 250mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
    break-after: page;
    box-sizing: border-box;
  }

  /* Cabeçalho da Capa */
  .cover-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 12px;
    margin-bottom: 14px;
  }
  .cover-brand-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .cover-logo {
    width: 46px;
    height: 46px;
    object-fit: contain;
  }
  .brand-name {
    font-size: 14pt;
    font-weight: 800;
    color: #d97706;
    letter-spacing: 1.5px;
    line-height: 1.1;
  }
  .brand-sub {
    font-size: 7.5pt;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }
  .cover-company-box {
    text-align: right;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 14px;
    max-width: 50%;
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }
  .company-txt {
    font-size: 10.5pt;
    font-weight: 700;
    color: #0f172a;
    word-break: break-word;
  }

  /* Corpo Central da Capa */
  .cover-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding: 6px 0;
  }

  /* Imagem de Capa */
  .cover-hero-img-wrap {
    width: 100%;
    max-height: 320px;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    margin-top: 14px;
    margin-bottom: 8px;
    background: #f8fafc;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    box-sizing: border-box;
  }
  .cover-hero-img {
    max-width: 100%;
    max-height: 308px;
    object-fit: contain;
    border-radius: 4px;
    display: block;
  }

  /* Categorias */
  .category-badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .category-badge {
    font-size: 8pt;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Título */
  .cover-title {
    font-size: 21pt;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.25;
    margin: 2px 0 8px 0;
    word-break: break-word;
  }
  .accent-line {
    width: 50px;
    height: 4px;
    background: #d97706;
    border-radius: 2px;
    margin-bottom: 12px;
  }

  /* Caixa de Descrição / Objetivo */
  .cover-desc-box {
    background: #f8fafc;
    border-left: 4px solid #d97706;
    border-radius: 0 6px 6px 0;
    border-top: 1px solid #e2e8f0;
    border-right: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    padding: 10px 14px;
    margin-top: 2px;
  }
  .desc-title {
    font-size: 8pt;
    font-weight: 700;
    color: #d97706;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .desc-text {
    font-size: 10pt;
    color: #334155;
    line-height: 1.5;
  }
  .desc-text p {
    margin: 0 0 6px 0;
  }
  .desc-text p:last-child {
    margin-bottom: 0;
  }

  /* Rodapé com Metadados da Capa (2x2 Grid) */
  .cover-footer {
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid #e2e8f0;
  }
  .meta-grid-2x2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
  }
  .meta-cell {
    display: flex;
    flex-direction: column;
  }
  .meta-cell-label {
    font-size: 7pt;
    color: #64748b;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .meta-cell-value {
    font-size: 9.5pt;
    color: #0f172a;
    font-weight: 700;
    word-break: break-word;
  }
  .cover-legal {
    text-align: center;
    font-size: 7.5pt;
    color: #94a3b8;
    margin-top: 8px;
  }

  /* ==================== PÁGINA DE ÍNDICE / SUMÁRIO ==================== */
  .index-heading-wrap {
    margin-bottom: 18px;
  }
  .index-title {
    font-size: 20pt;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 8px 0;
  }
  .index-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .index-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }
  .index-item-left {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 75%;
  }
  .index-step-badge {
    background: #d97706;
    color: #ffffff;
    font-size: 8.5pt;
    font-weight: 800;
    padding: 4px 8px;
    border-radius: 4px;
    min-width: 28px;
    text-align: center;
  }
  .index-step-title {
    font-size: 10.5pt;
    font-weight: 700;
    color: #0f172a;
    word-break: break-word;
  }
  .index-dots {
    flex: 1;
    border-bottom: 1.5px dotted #cbd5e1;
    margin: 0 12px;
    height: 1px;
  }
  .index-page-num {
    font-size: 9.5pt;
    font-weight: 700;
    color: #d97706;
    white-space: nowrap;
    background: #fff;
    border: 1px solid #e2e8f0;
    padding: 4px 10px;
    border-radius: 4px;
  }

  /* ==================== ETAPAS ==================== */
  .step-header {
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  .step-tag {
    font-size: 8pt;
    color: #d97706;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .step-title {
    font-size: 16pt;
    font-weight: 700;
    color: #0f172a;
    margin: 2px 0 0 0;
  }
  .step-content {
    font-size: 10.5pt;
    color: #334155;
    line-height: 1.5;
  }
  .step-content p {
    margin: 0 0 6px 0;
  }
  .step-content ul, .step-content ol {
    margin: 4px 0 8px 18px;
  }
  /* Grid de fotos das etapas (2 colunas para manter fotos grandes e legíveis) */
  .step-photos-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 14px 0;
    justify-content: flex-start;
  }
  .step-photos-grid.single-photo {
    justify-content: center;
  }
  .step-photo-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 6px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1 1 calc(50% - 12px);
    max-width: calc(50% - 6px);
  }
  .step-photos-grid.single-photo .step-photo-card {
    flex: 0 1 100%;
    max-width: 540px;
    padding: 8px;
  }
  .step-photo-img {
    max-width: 100%;
    max-height: 220px;
    object-fit: contain;
    border-radius: 4px;
    display: block;
    margin: 0 auto;
  }
  .step-photos-grid.single-photo .step-photo-img {
    max-height: 280px;
  }
`;

// Renderiza o pequenino cabeçalho repetido no topo de cada folha após a capa
function renderMiniHeader(content: PdfContent): string {
  return `
    <div class="mini-header">
      <div class="mini-header-left">
        ${content.logoSrc ? `<img class="mini-logo" src="${content.logoSrc}" alt="Logo" />` : ''}
        <span class="mini-brand">SMART GUIDE</span>
        <span class="mini-sep">•</span>
        <span class="mini-title">${escapeHtml(content.training.title)}</span>
      </div>
      <div class="mini-header-right">
        ${content.companyName ? `<span class="mini-company">${escapeHtml(content.companyName)}</span>` : ''}
      </div>
    </div>
  `;
}

// Renderiza o rodapé com número de página (Página X de Y)
function renderPageFooter(pageNum: number, totalPages: number): string {
  return `
    <div class="page-footer">
      <div class="page-footer-left">SmartGuide • Guia Oficial de Treinamento Corporativo</div>
      <div class="page-footer-right">Página ${pageNum} de ${totalPages}</div>
    </div>
  `;
}

// Renderiza a Capa (Página 1)
function buildCoverHtml(content: PdfContent): string {
  const { training, steps, companyName, creatorName, logoSrc, coverImageSrc } = content;
  const categories = training.categories || [];

  return `
    <section class="cover-page">
      <!-- Cabeçalho Institucional -->
      <div class="cover-header">
        <div class="cover-brand-wrap">
          ${logoSrc ? `<img class="cover-logo" src="${logoSrc}" alt="Logo" />` : ''}
          <div>
            <div class="brand-name">SMART GUIDE</div>
            <div class="brand-sub">Guia Corporativo de Treinamento</div>
          </div>
        </div>
        ${
          companyName
            ? `
          <div class="cover-company-box">
            <div class="company-txt">${escapeHtml(companyName)}</div>
          </div>
        `
            : ''
        }
      </div>

      <!-- Conteúdo Central -->
      <div class="cover-body">
        <!-- Badges de Categorias -->
        ${
          categories.length > 0
            ? `
          <div class="category-badges">
            ${categories
              .map(
                (c) => `
              <span class="category-badge" style="background-color: ${c.color || '#F39C12'}20; color: ${c.color || '#D97706'}; border: 1px solid ${c.color || '#F39C12'}50;">
                ${escapeHtml(c.name)}
              </span>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }

        <!-- Título do Treinamento -->
        <h1 class="cover-title">${escapeHtml(training.title)}</h1>
        <div class="accent-line"></div>

        <!-- Caixa de Descrição / Objetivo -->
        ${
          training.description
            ? `
          <div class="cover-desc-box">
            <div class="desc-title">Objetivo e Visão Geral</div>
            <div class="desc-text">${training.description}</div>
          </div>
        `
            : ''
        }

        <!-- Imagem de Capa do Treinamento -->
        ${
          coverImageSrc
            ? `
          <div class="cover-hero-img-wrap">
            <img class="cover-hero-img" src="${coverImageSrc}" alt="Capa do Treinamento" />
          </div>
        `
            : ''
        }
      </div>

      <!-- Rodapé com Metadados Detalhados (Quem criou, Quando criou, Última Modificação, Status) -->
      <div class="cover-footer">
        <div class="meta-grid-2x2">
          <div class="meta-cell">
            <span class="meta-cell-label">Criado Por</span>
            <span class="meta-cell-value">${escapeHtml(creatorName || 'Administrador')}</span>
          </div>
          <div class="meta-cell">
            <span class="meta-cell-label">Data de Criação</span>
            <span class="meta-cell-value">${formatDateTime(training.created_at)}</span>
          </div>
          <div class="meta-cell">
            <span class="meta-cell-label">Última Modificação</span>
            <span class="meta-cell-value">${formatDateTime(training.updated_at)}</span>
          </div>
          <div class="meta-cell">
            <span class="meta-cell-label">Estrutura & Status</span>
            <span class="meta-cell-value">
              ${steps.length} ${steps.length === 1 ? 'etapa' : 'etapas'} • 
              <span style="color: ${training.status === 'published' ? '#059669' : '#d97706'};">
                ${training.status === 'published' ? 'Publicado' : 'Em Rascunho'}
              </span>
            </span>
          </div>
        </div>
        <div class="cover-legal">
          Documento gerado automaticamente pela plataforma SmartGuide • Página 1
        </div>
      </div>
    </section>
  `;
}

interface StepPageChunk {
  step: TrainingStep;
  stepIndex: number;
  totalSteps: number;
  startPage: number;
  pageCount: number;
  photoChunks: string[][];
}

// Renderiza a Página de Sumário / Índice (Página 2)
function buildIndexHtml(
  content: PdfContent,
  stepChunks: StepPageChunk[],
  totalPages: number
): string {
  return `
    <section class="page-break sheet-page">
      ${renderMiniHeader(content)}

      <div class="sheet-body">
        <div class="index-heading-wrap">
          <h2 class="index-title">Índice</h2>
          <div class="accent-line"></div>
        </div>

        <div class="index-list">
          ${stepChunks
            .map(
              (item) => `
              <div class="index-item">
                <div class="index-item-left">
                  <span class="index-step-badge">${String(item.stepIndex + 1).padStart(2, '0')}</span>
                  <span class="index-step-title">${escapeHtml(item.step.title)}</span>
                </div>
                <div class="index-dots"></div>
                <div class="index-page-num">Pág. ${item.startPage}</div>
              </div>
            `
            )
            .join('')}
        </div>
      </div>

      ${renderPageFooter(2, totalPages)}
    </section>
  `;
}

// Renderiza as folhas de uma etapa (com suporte a quebra limpa em múltiplas folhas caso haja mais de 4 fotos)
function buildStepPagesHtml(
  chunkItem: StepPageChunk,
  content: PdfContent,
  totalPages: number
): string {
  const { step, stepIndex, totalSteps, startPage, photoChunks } = chunkItem;

  return photoChunks
    .map((chunk, chunkIdx) => {
      const pageNum = startPage + chunkIdx;
      const isContinuation = chunkIdx > 0;

      let photosHtml = '';
      if (chunk.length === 1 && !isContinuation) {
        photosHtml = `
          <div class="step-photos-grid single-photo">
            <div class="step-photo-card">
              <img class="step-photo-img" src="${chunk[0]}" alt="Foto da Etapa" />
            </div>
          </div>
        `;
      } else if (chunk.length > 0) {
        photosHtml = `
          <div class="step-photos-grid">
            ${chunk
              .map(
                (src) => `
              <div class="step-photo-card">
                <img class="step-photo-img" src="${src}" alt="Foto da Etapa" />
              </div>
            `
              )
              .join('')}
          </div>
        `;
      }

      return `
        <section class="page-break sheet-page">
          ${renderMiniHeader(content)}

          <div class="sheet-body">
            <div class="step-header">
              <div class="step-tag">Etapa ${stepIndex + 1} de ${totalSteps}${isContinuation ? ' • Continuação' : ''}</div>
              <h2 class="step-title">${escapeHtml(step.title)}</h2>
            </div>
            ${!isContinuation && step.content ? `<div class="step-content">${step.content}</div>` : ''}
            ${photosHtml}
          </div>

          ${renderPageFooter(pageNum, totalPages)}
        </section>
      `;
    })
    .join('');
}

// Monta o documento HTML completo com paginação exata
async function buildHtml(content: PdfContent): Promise<string> {
  const orderedSteps = [...content.steps].sort((a, b) => a.step_order - b.step_order);

  // Divide etapas com muitas fotos em blocos de até 4 fotos por folha (2 colunas grandes e legíveis)
  // Página 1 = Capa
  // Página 2 = Índice
  let currentPage = 3;
  const stepChunks: StepPageChunk[] = [];

  for (let i = 0; i < orderedSteps.length; i++) {
    const step = orderedSteps[i];
    const photos = (step.attachments || [])
      .filter((att) => att.file_type === 'image' && att.file_url)
      .sort((a, b) => (a.att_order ?? 0) - (b.att_order ?? 0));

    const photoSrcs = await Promise.all(photos.map((p) => toPrintableSrc(p.file_url)));
    const validPhotos = photoSrcs.filter(Boolean);

    const chunks: string[][] = [];
    if (validPhotos.length === 0) {
      chunks.push([]);
    } else if (validPhotos.length <= 4) {
      chunks.push(validPhotos);
    } else {
      // Máximo 4 fotos por folha para manter as fotos grandes, legíveis e com cabeçalho/rodapé corretos
      for (let p = 0; p < validPhotos.length; p += 4) {
        chunks.push(validPhotos.slice(p, p + 4));
      }
    }

    const pageCount = chunks.length;
    stepChunks.push({
      step,
      stepIndex: i,
      totalSteps: orderedSteps.length,
      startPage: currentPage,
      pageCount,
      photoChunks: chunks,
    });
    currentPage += pageCount;
  }

  const totalPages = currentPage - 1;

  const coverHtml = buildCoverHtml(content);
  const indexHtml = buildIndexHtml(content, stepChunks, totalPages);
  const stepsHtml = stepChunks
    .map((chunkItem) => buildStepPagesHtml(chunkItem, content, totalPages))
    .join('');

  return `<!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(content.training.title)}</title>
        <style>${PDF_STYLES}</style>
      </head>
      <body>
        ${coverHtml}
        ${indexHtml}
        ${stepsHtml}
      </body>
    </html>`;
}

// ------------------------------------------------------------------------------
// Saída por plataforma
// ------------------------------------------------------------------------------

// Web: imprime o HTML em um iframe oculto (o navegador oferece "Salvar como PDF")
function printOnWeb(html: string, title: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';

    // O evento onload só dispara depois que todas as imagens carregaram
    iframe.onload = () => {
      const originalTitle = document.title;
      document.title = toFileName(title); // Sugere o nome do arquivo PDF
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      document.title = originalTitle;
      setTimeout(() => {
        iframe.remove();
        resolve();
      }, 500);
    };

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

// Mobile: gera o arquivo PDF e abre o menu nativo para salvar/compartilhar
async function saveOnNative(html: string, title: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html, ...A4 });

  // Renomeia o arquivo para o nome do treinamento
  const target = `${FileSystem.cacheDirectory}${toFileName(title)}.pdf`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: target });

  await Sharing.shareAsync(target, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: title,
  });
}

// ------------------------------------------------------------------------------
// API pública
// ------------------------------------------------------------------------------

export const pdfService = {
  // Gera e baixa o PDF do treinamento completo (capa detalhada + índice + etapas)
  async generateTrainingPdf(training: Training, steps: TrainingStep[]): Promise<void> {
    const [companyName, creatorName, logoSrc, coverImageSrc] = await Promise.all([
      getCompanyName(training.company_id),
      getCreatorName(training.created_by),
      getLogoSrc(),
      training.cover_url ? toPrintableSrc(training.cover_url) : Promise.resolve(''),
    ]);

    const html = await buildHtml({
      training,
      steps,
      companyName,
      creatorName,
      logoSrc,
      coverImageSrc,
    });

    if (Platform.OS === 'web') {
      await printOnWeb(html, training.title);
    } else {
      await saveOnNative(html, training.title);
    }
  },
};
