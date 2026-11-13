import { type PropsWithChildren } from 'react';

// ==============================================================================
// Template HTML Raiz para Web (+html.tsx)
// Configura o boilerplate do documento web e pré-carrega as fontes do Ionicons
// ==============================================================================

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <title>Smart Guide - Treinamentos Corporativos</title>
        <link rel="icon" href="/favicon.ico" />

        {/* Pré-carregamento imediato da fonte dos ícones (Ionicons oficial) */}
        <link
          rel="preload"
          href="/fonts/Ionicons.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />

        {/* Definição de @font-face para 'ionicons' e 'Ionicons' com a fonte oficial */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
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
              /* Reset recomendado para react-native-web */
              html, body {
                height: 100%;
              }
              body {
                overflow: hidden;
              }
              #root {
                display: flex;
                height: 100%;
                flex: 1;
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
