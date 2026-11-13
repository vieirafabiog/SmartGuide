import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Footer } from '../../components/Footer';
import { LanguageSelector } from '../../components/LanguageSelector';
import { colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import {
  connectToServer,
  ServerConfigError,
} from '../../services/serverConfig.service';

function extractServerUrlFromDeepLinkOrQr(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return '';

  if (trimmed.toLowerCase().startsWith('smartguide://')) {
    const parsed = Linking.parse(trimmed);
    const serverParam = parsed.queryParams?.server;
    const server = Array.isArray(serverParam) ? serverParam[0] : serverParam;
    return typeof server === 'string' ? server.trim() : '';
  }

  return trimmed;
}

export default function ConnectServerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { serverUrl, refreshInstanceInfo } = useAuth();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const incomingUrl = Linking.useURL();

  const topPadding = Platform.OS !== 'web' ? insets.top + 16 : 20;
  const bottomPadding = Platform.OS !== 'web' ? insets.bottom + 16 : 20;

  const [urlInput, setUrlInput] = useState(serverUrl || '');
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedLock, setScannedLock] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConnect = useCallback(
    async (candidateUrl: string) => {
      const target = candidateUrl.trim();
      if (!target) {
        setErrorMessage('Informe a URL do servidor Smart Guide.');
        return;
      }

      try {
        setLoading(true);
        setErrorMessage(null);
        await connectToServer(target);
        await refreshInstanceInfo();
        router.replace('/(auth)/login');
      } catch (err) {
        if (err instanceof ServerConfigError) {
          setErrorMessage(err.message);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Não foi possível conectar ao servidor informado.');
        }
      } finally {
        setLoading(false);
      }
    },
    [refreshInstanceInfo, router],
  );

  useEffect(() => {
    if (!incomingUrl) return;
    const extracted = extractServerUrlFromDeepLinkOrQr(incomingUrl);
    if (extracted && (extracted.startsWith('http://') || extracted.startsWith('https://'))) {
      void Promise.resolve().then(() => {
        setUrlInput(extracted);
        return handleConnect(extracted);
      });
    }
  }, [incomingUrl, handleConnect]);

  const openQrScanner = async () => {
    setErrorMessage(null);
    if (!cameraPermission?.granted) {
      const granted = await requestCameraPermission();
      if (!granted.granted) {
        setErrorMessage('Permissão da câmera é necessária para escanear o QR Code.');
        return;
      }
    }
    setScannedLock(false);
    setScannerOpen(true);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scannedLock) return;
    setScannedLock(true);
    setScannerOpen(false);
    const extracted = extractServerUrlFromDeepLinkOrQr(data);
    if (extracted) {
      setUrlInput(extracted);
      void handleConnect(extracted);
    } else {
      setErrorMessage('QR Code inválido. Informe uma URL Smart Guide válida.');
    }
  };

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContainer,
            { paddingTop: topPadding, paddingBottom: bottomPadding },
          ]}
        >
          <View style={styles.card}>
            <LanguageSelector compact />
            <View style={styles.header}>
              <Image
                source={require('../../../assets/icon.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
              <Text style={styles.title}>{t('byos.title')}</Text>
              <Text style={styles.subtitle}>{t('byos.subtitle')}</Text>
            </View>

            {errorMessage && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {scannerOpen ? (
              <View style={styles.scannerContainer}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={handleBarcodeScanned}
                />
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => setScannerOpen(false)}
                >
                  <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{t('byos.serverUrlLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={t('byos.serverUrlPlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    value={urlInput}
                    onChangeText={setUrlInput}
                  />
                </View>

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => void handleConnect(urlInput)}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.textInverse} size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>{t('byos.connectButton')}</Text>
                  )}
                </TouchableOpacity>

                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => void openQrScanner()}
                    disabled={loading}
                  >
                    <Ionicons
                      name="qr-code-outline"
                      size={18}
                      color={colors.text}
                      style={styles.btnIcon}
                    />
                    <Text style={styles.secondaryBtnText}>{t('byos.scanQrButton')}</Text>
                  </TouchableOpacity>
                )}

                {Boolean(serverUrl) && (
                  <TouchableOpacity
                    style={styles.linkBtn}
                    onPress={() => router.replace('/(auth)/login')}
                  >
                    <Text style={styles.linkBtnText}>Voltar para Login</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 4,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoImage: {
    width: 64,
    height: 64,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: colors.dangerLight,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 3,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 16,
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
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 15,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    paddingVertical: 11,
    marginTop: 12,
    backgroundColor: colors.surface,
  },
  btnIcon: {
    marginRight: 8,
  },
  secondaryBtnText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  linkBtn: {
    marginTop: 14,
    alignItems: 'center',
  },
  linkBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  scannerContainer: {
    marginTop: 8,
  },
  camera: {
    width: '100%',
    height: 260,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
