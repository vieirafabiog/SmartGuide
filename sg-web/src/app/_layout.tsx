// ==============================================================================
// Layout Raiz do Aplicativo (Root Layout)
// Configura o provedor de autenticação e a pilha de navegação principal
// ==============================================================================

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../context/AuthContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Head>
          <title>Smart Guide - Treinamentos Corporativos</title>
          <link rel="icon" href="/favicon.ico" />
          <link rel="shortcut icon" href="/favicon.ico" />
          <link
            rel="preload"
            href="/fonts/Ionicons.ttf"
            as="font"
            type="font/ttf"
            crossOrigin="anonymous"
          />
          <style>{`
            @font-face {
              font-family: 'ionicons';
              src: url('/fonts/Ionicons.ttf') format('truetype');
              font-weight: normal;
              font-style: normal;
              font-display: block;
            }
            @font-face {
              font-family: 'Ionicons';
              src: url('/fonts/Ionicons.ttf') format('truetype');
              font-weight: normal;
              font-style: normal;
              font-display: block;
            }
          `}</style>
        </Head>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="training/create"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="training/[id]/index"
            options={{
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="training/[id]/edit"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="training/[id]/share"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
