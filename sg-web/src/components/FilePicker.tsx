import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import type { NativeUploadFile } from '../services/storage.service';
import {
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_VIDEO_EXTENSIONS,
  validateMediaFile,
} from '../utils/mediaCompressor';

export type PickedFileItem = File | NativeUploadFile;

interface FilePickerProps {
  onFilesSelected: (files: PickedFileItem[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
  isUploading?: boolean;
  buttonText?: string;
  iconName?: keyof typeof Ionicons.glyphMap;
}

function getExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  const idx = lower.lastIndexOf('.');
  return idx !== -1 ? lower.slice(idx) : '';
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

  const allowedCategory: 'image' | 'video' | 'any' =
    accept === 'image/*' ? 'image' : accept === 'video/*' ? 'video' : 'any';

  const handleNativePick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permissão necessária',
        'Permita o acesso à galeria para selecionar imagens ou vídeos.',
      );
      return;
    }

    const mediaTypes: ImagePicker.MediaType[] =
      allowedCategory === 'image'
        ? ['images']
        : allowedCategory === 'video'
          ? ['videos']
          : ['images', 'videos'];

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsMultipleSelection: multiple,
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    const selected: NativeUploadFile[] = [];
    for (const asset of result.assets) {
      const isVideo = asset.type === 'video';
      const fallbackExt = isVideo ? 'mp4' : 'jpg';
      const fileName = asset.fileName?.trim() || `media_${Date.now()}.${fallbackExt}`;
      const ext = getExtension(fileName);

      if (allowedCategory === 'image' && isVideo) continue;
      if (allowedCategory === 'video' && !isVideo) continue;

      if (
        ext &&
        !ALLOWED_IMAGE_EXTENSIONS.includes(ext) &&
        !ALLOWED_VIDEO_EXTENSIONS.includes(ext)
      ) {
        Alert.alert('Arquivo não suportado', `O arquivo "${fileName}" não é permitido.`);
        continue;
      }

      selected.push({
        uri: asset.uri,
        name: fileName,
        type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
      });
    }

    if (selected.length > 0) {
      onFilesSelected(selected);
    }
  };

  const handlePress = () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
      return;
    }
    void handleNativePick();
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target?.files;
    if (!fileList || fileList.length === 0) return;

    const validFiles: File[] = [];
    for (const file of Array.from(fileList)) {
      const validation = validateMediaFile(file, file.name, allowedCategory);
      if (!validation.valid) {
        Alert.alert('Arquivo inválido', validation.error || 'Arquivo não suportado.');
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}

      {Platform.OS === 'web' && (
        <input
          ref={fileInputRef}
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
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.primaryHover,
    fontSize: 14,
    fontWeight: '600',
  },
});
