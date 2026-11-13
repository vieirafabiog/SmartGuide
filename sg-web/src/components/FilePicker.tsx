// ==============================================================================
// Componente: FilePicker (Seletor de Arquivos para Upload)
// Permite selecionar imagens e vídeos no navegador ou no celular
// ==============================================================================

import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { validateMediaFile } from '../utils/mediaCompressor';

interface FilePickerProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string; // 'image/*' ou 'video/*' ou 'image/*,video/*'
  multiple?: boolean;
  label?: string;
  isUploading?: boolean;
  buttonText?: string;
  iconName?: keyof typeof Ionicons.glyphMap;
}

export const FilePicker: React.FC<FilePickerProps> = ({
  onFilesSelected,
  accept = 'image/*,video/*',
  multiple = false,
  label,
  isUploading = false,
  buttonText = 'Selecionar Arquivo',
  iconName = 'cloud-upload-outline',
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePress = () => {
    if (Platform.OS === 'web') {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    } else {
      // No mobile nativo pode usar expo-document-picker ou expo-image-picker
      alert('Upload de arquivos disponível diretamente via interface Web.');
    }
  };

  const handleInputChange = (event: any) => {
    const fileList = event.target?.files;
    if (fileList && fileList.length > 0) {
      const filesArray = Array.from(fileList) as File[];

      const allowedCategory: 'image' | 'video' | 'any' =
        accept === 'image/*' ? 'image' : accept === 'video/*' ? 'video' : 'any';

      const validFiles: File[] = [];
      for (const file of filesArray) {
        const validation = validateMediaFile(file, file.name, allowedCategory);
        if (!validation.valid) {
          alert(validation.error || 'Arquivo não suportado.');
          continue;
        }
        validFiles.push(file);
      }

      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }

      // Reseta o input para permitir selecionar o mesmo arquivo novamente se desejar
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}

      {/* Input HTML oculto para Web */}
      {Platform.OS === 'web' && (
        <input
          ref={fileInputRef as any}
          type="file"
          accept={accept}
          multiple={multiple}
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
      )}

      <TouchableOpacity
        style={[styles.button, isUploading && styles.buttonDisabled]}
        onPress={handlePress}
        disabled={isUploading}
        activeOpacity={0.8}
      >
        {isUploading ? (
          <ActivityIndicator size="small" color={colors.primaryHover} />
        ) : (
          <Ionicons name={iconName} size={18} color={colors.primaryHover} />
        )}
        <Text style={styles.buttonText}>
          {isUploading ? 'Enviando arquivo...' : buttonText}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: colors.primaryLight,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryHover,
  },
});
