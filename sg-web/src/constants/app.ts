// ==============================================================================
// Configurações Globais do SmartGuide
// ==============================================================================

export const APP_CONFIG = {
  name: 'Smart Guide',
  description: 'Treinamentos Corporativos Internos',
  version: '1.0.0',
  build: '2026.1',
  footerText: 'Smart Guide © 2026 - Versão 1.0.0',

  // Paginação otimizada para baixo consumo de dados
  pagination: {
    trainingsPerPage: 12,
    adminItemsPerPage: 20,
  },

  // Limites de upload de mídia
  limits: {
    maxImageSizeMB: 5,
    maxVideoSizeMB: 50,
  },
};
