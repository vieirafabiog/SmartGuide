// ==============================================================================
// Componente: TrainingCard (Card de Treinamento)
// Visual corporativo e limpo, inspirado no Power Apps SmartGuide original
// ==============================================================================

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../constants/colors';
import { Training } from '../types/database';

interface TrainingCardProps {
  training: Training;
  onPress: () => void;
  onEditPress?: () => void;
  showAdminActions?: boolean;
  isDownloaded?: boolean;
}

export const TrainingCard: React.FC<TrainingCardProps> = ({
  training,
  onPress,
  onEditPress,
  showAdminActions = false,
  isDownloaded = false,
}) => {
  const { t } = useTranslation();
  const progress = training.user_progress ?? 0;
  const isCompleted = progress >= 100;

  return (
    <View style={styles.card}>
      {/* Imagem de Capa do Treinamento */}
      <View style={styles.imageContainer}>
        {training.cover_url ? (
          <Image source={{ uri: training.cover_url }} style={styles.coverImage} resizeMode="cover" />
        ) : (
          <View style={styles.placeholderCover}>
            <Text style={styles.placeholderText}>SMART GUIDE</Text>
          </View>
        )}

        {/* Badge de Status (se em modo administrativo ou rascunho) */}
        {training.status !== 'published' && (
          <View
            style={[
              styles.statusBadge,
              training.status === 'draft' ? styles.draftBadge : styles.archivedBadge,
            ]}
          >
            <Text style={styles.statusBadgeText}>
              {(training.status === 'draft'
                ? t('catalog.statusDraft')
                : t('catalog.statusArchived')
              ).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Badge de Etapas */}
        <View style={styles.stepsBadge}>
          <Text style={styles.stepsBadgeText}>
            {t('catalog.stepsCount', { count: training.total_steps || 0 })}
          </Text>
        </View>

        {/* Badge de Disponibilidade Offline */}
        {isDownloaded && (
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-done" size={11} color="#FFF" />
            <Text style={styles.offlineBadgeText}>{t('catalog.downloadedBadge')}</Text>
          </View>
        )}
      </View>

      {/* Conteúdo do Card */}
      <View style={styles.body}>
        {/* Categorias */}
        <View style={styles.categoriesRow}>
          {(training.categories || []).slice(0, 2).map((cat) => (
            <View key={cat.id} style={[styles.categoryBadge, { backgroundColor: cat.color + '20' }]}>
              <Text style={[styles.categoryBadgeText, { color: cat.color }]}>{cat.name}</Text>
            </View>
          ))}
        </View>

        {/* Título do Treinamento */}
        <Text style={styles.title} numberOfLines={2}>
          {training.title}
        </Text>

        {/* Barra de Progresso */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {isCompleted ? t('training.player.completedBadge') : `${progress}%`}
          </Text>
        </View>

        {/* Botões de Ação */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.primaryBtn} onPress={onPress} activeOpacity={0.8}>
            <Text style={styles.primaryBtnText}>
              {progress > 0 ? t('training.player.continueStudy') : t('training.player.startStudy')}
            </Text>
          </TouchableOpacity>

          {showAdminActions && onEditPress && (
            <TouchableOpacity style={styles.editBtn} onPress={onEditPress}>
              <Text style={styles.editBtnText}>{t('common.edit')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 16,
    // Sombra leve para profundidade sem exagero
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  imageContainer: {
    height: 140,
    width: '100%',
    backgroundColor: '#EEEEEE',
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  placeholderCover: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  statusBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
  },
  draftBadge: {
    backgroundColor: '#F39C12',
  },
  archivedBadge: {
    backgroundColor: '#7F8C8D',
  },
  statusBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  stepsBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
  },
  stepsBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  offlineBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16A34A',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 3,
  },
  offlineBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  body: {
    padding: 14,
  },
  categoriesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 2,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.text,
    lineHeight: 20,
    marginBottom: 12,
    minHeight: 40,
  },
  progressContainer: {
    marginBottom: 12,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  progressText: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 8,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 13,
  },
  editBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 3,
  },
  editBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
