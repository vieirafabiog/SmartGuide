import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
import { APP_CONFIG } from '../../constants/app';
import { colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { getPinnedApiUrl } from '../../services/serverConfig.service';

export default function LoginScreen() {
  const router = useRouter();
  const {
    instanceInfo,
    serverUrl,
    isLoading: authLoading,
    signIn,
    signUp,
    signInWithProvider,
  } = useAuth();
  const insets = useSafeAreaInsets();

  const topPadding = Platform.OS !== 'web' ? insets.top + 16 : 20;
  const bottomPadding = Platform.OS !== 'web' ? insets.bottom + 16 : 20;

  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pinnedApiUrl = getPinnedApiUrl();
  const canSwitchServer = Platform.OS !== 'web' && !pinnedApiUrl;

  useEffect(() => {
    if (!authLoading && Platform.OS !== 'web' && !serverUrl && !pinnedApiUrl) {
      router.replace('/(auth)/connect-server');
    }
  }, [authLoading, serverUrl, pinnedApiUrl, router]);

  const showEmailPassword = instanceInfo?.authProviders.emailPassword ?? true;
  const showGoogle = instanceInfo?.authProviders.google ?? false;
  const showMicrosoft = instanceInfo?.authProviders.microsoft ?? false;
  const allowPublicSignup = instanceInfo?.allowPublicSignup ?? false;

  const handleSubmit = async () => {
    if (!email.trim() || !password || (isSignUpMode && !name.trim())) {
      setErrorMessage('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);

      const result = isSignUpMode
        ? await signUp(name, email, password)
        : await signIn(email, password);

      if (result.success) {
        router.replace('/(tabs)');
      } else {
        setErrorMessage(result.error || 'Credenciais inválidas.');
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro ao realizar autenticação.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'microsoft') => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const result = await signInWithProvider(provider);
      if (result.success) {
        if (Platform.OS !== 'web') {
          router.replace('/(tabs)');
        }
      } else {
        setErrorMessage(result.error || 'Falha ao autenticar com provedor.');
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro ao autenticar com provedor.',
      );
    } finally {
      setLoading(false);
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
            <View style={styles.header}>
              <Image
                source={
                  instanceInfo?.logoUrl
                    ? { uri: instanceInfo.logoUrl }
                    : require('../../../assets/icon.png')
                }
                style={styles.logoImage}
                resizeMode="contain"
              />
              <Text style={styles.title}>{instanceInfo?.name || APP_CONFIG.name}</Text>
              <Text style={styles.subtitle}>{APP_CONFIG.description}</Text>
            </View>

            {errorMessage && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {showEmailPassword && (
              <>
                {isSignUpMode && (
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Nome Completo</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Seu nome"
                      placeholderTextColor={colors.textMuted}
                      value={name}
                      onChangeText={setName}
                    />
                  </View>
                )}

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>E-mail Corporativo</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="seu.email@empresa.com"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Senha de Acesso</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Digite sua senha"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                  />
                </View>

                <TouchableOpacity
                  style={styles.loginBtn}
                  onPress={() => void handleSubmit()}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.textInverse} size="small" />
                  ) : (
                    <Text style={styles.loginBtnText}>
                      {isSignUpMode ? 'Criar Conta' : 'Entrar no Sistema'}
                    </Text>
                  )}
                </TouchableOpacity>

                {allowPublicSignup && (
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => {
                      setIsSignUpMode((prev) => !prev);
                      setErrorMessage(null);
                    }}
                    disabled={loading}
                  >
                    <Text style={styles.toggleBtnText}>
                      {isSignUpMode
                        ? 'Já possui conta? Entrar'
                        : 'Não possui conta? Cadastre-se'}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {(showGoogle || showMicrosoft) && (
              <View style={styles.oauthSection}>
                {showEmailPassword && (
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>ou continue com</Text>
                    <View style={styles.dividerLine} />
                  </View>
                )}

                {showGoogle && (
                  <TouchableOpacity
                    style={styles.oauthBtn}
                    onPress={() => void handleSocialLogin('google')}
                    disabled={loading}
                  >
                    <Ionicons
                      name="logo-google"
                      size={18}
                      color={colors.text}
                      style={styles.oauthIcon}
                    />
                    <Text style={styles.oauthBtnText}>Entrar com Google</Text>
                  </TouchableOpacity>
                )}

                {showMicrosoft && (
                  <TouchableOpacity
                    style={styles.oauthBtn}
                    onPress={() => void handleSocialLogin('microsoft')}
                    disabled={loading}
                  >
                    <Ionicons
                      name="logo-microsoft"
                      size={18}
                      color={colors.text}
                      style={styles.oauthIcon}
                    />
                    <Text style={styles.oauthBtnText}>Entrar com Microsoft</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {canSwitchServer && (
              <TouchableOpacity
                style={styles.switchServerBtn}
                onPress={() => router.push('/(auth)/connect-server')}
                disabled={loading}
              >
                <Text style={styles.switchServerText}>
                  Alterar servidor ({serverUrl || 'não configurado'})
                </Text>
              </TouchableOpacity>
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
  loginBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  loginBtnText: {
    color: colors.textInverse,
    fontWeight: 'bold',
    fontSize: 15,
  },
  toggleBtn: {
    marginTop: 12,
    alignItems: 'center',
  },
  toggleBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  oauthSection: {
    marginTop: 16,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderLight,
  },
  dividerText: {
    marginHorizontal: 10,
    fontSize: 12,
    color: colors.textSecondary,
  },
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    paddingVertical: 11,
    marginTop: 8,
    backgroundColor: colors.surface,
  },
  oauthIcon: {
    marginRight: 8,
  },
  oauthBtnText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  switchServerBtn: {
    marginTop: 18,
    alignItems: 'center',
  },
  switchServerText: {
    color: colors.textSecondary,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
