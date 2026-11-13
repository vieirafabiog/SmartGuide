// ==============================================================================
// Layout do Grupo de Autenticação (Auth Layout)
// ==============================================================================

import React from 'react';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ title: 'Entrar no Smart Guide' }} />
    </Stack>
  );
}
