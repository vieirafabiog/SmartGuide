// ==============================================================================
// Rota Raiz (/)
// Redireciona o usuário para as abas principais ou tela de login
// ==============================================================================

import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/(tabs)" />;
}
