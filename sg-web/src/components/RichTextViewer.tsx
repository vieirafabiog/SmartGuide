// ==============================================================================
// Componente: RichTextViewer (Visualizador de Texto Rico Simples)
// Converte tags HTML comuns em elementos de texto estilizados no React Native
// ==============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../constants/colors';

interface RichTextViewerProps {
  content?: string | null;
}

export const RichTextViewer: React.FC<RichTextViewerProps> = ({ content }) => {
  if (!content || content.trim() === '') {
    return <Text style={styles.emptyText}>Sem descrição ou conteúdo informado.</Text>;
  }

  // Se o conteúdo não tiver tags HTML, renderiza como texto puro
  if (!content.includes('<') || !content.includes('>')) {
    return <Text style={styles.paragraph}>{content}</Text>;
  }

  // Divisão básica em parágrafos e quebras de linha
  const cleanContent = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  // Extrai blocos entre tags simples
  const blocks = cleanContent
    .split(/(<\/?[a-z0-9]+[^>]*>)/gi)
    .filter(Boolean);

  interface ParsedNode {
    key: number;
    type: 'text' | 'newline' | 'bullet';
    tag?: string;
    text?: string;
  }

  const nodes: ParsedNode[] = [];
  let activeTag = '';

  blocks.forEach((chunk, index) => {
    if (chunk.startsWith('<') && chunk.endsWith('>')) {
      const tagMatch = chunk.match(/<\/?([a-z0-9]+)/i);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';

      if (chunk.startsWith('</')) {
        activeTag = '';
        if (tagName === 'p' || tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'li') {
          nodes.push({ key: index, type: 'newline' });
        }
      } else {
        activeTag = tagName;
        if (tagName === 'li') {
          nodes.push({ key: index, type: 'bullet' });
        }
      }
    } else {
      nodes.push({ key: index, type: 'text', tag: activeTag, text: chunk });
    }
  });

  return (
    <View style={styles.container}>
      <Text style={styles.textContainer}>
        {nodes.map((node) => {
          if (node.type === 'newline') {
            return <Text key={node.key}>{'\n'}</Text>;
          }
          if (node.type === 'bullet') {
            return (
              <Text key={node.key} style={styles.bullet}>
                •{' '}
              </Text>
            );
          }

          // Renderização do texto baseado na tag
          switch (node.tag) {
            case 'h1':
              return (
                <Text key={node.key} style={styles.h1}>
                  {node.text}
                </Text>
              );
            case 'h2':
              return (
                <Text key={node.key} style={styles.h2}>
                  {node.text}
                </Text>
              );
            case 'h3':
              return (
                <Text key={node.key} style={styles.h3}>
                  {node.text}
                </Text>
              );
            case 'b':
            case 'strong':
              return (
                <Text key={node.key} style={styles.bold}>
                  {node.text}
                </Text>
              );
            case 'i':
            case 'em':
              return (
                <Text key={node.key} style={styles.italic}>
                  {node.text}
                </Text>
              );
            case 'u':
              return (
                <Text key={node.key} style={styles.underline}>
                  {node.text}
                </Text>
              );
            default:
              return (
                <Text key={node.key} style={styles.paragraph}>
                  {node.text}
                </Text>
              );
          }
        })}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  textContainer: {
    lineHeight: 22,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  paragraph: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
  },
  h1: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginVertical: 4,
  },
  h2: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginVertical: 4,
  },
  h3: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primaryHover,
    marginVertical: 4,
  },
  bold: {
    fontWeight: 'bold',
    color: colors.text,
  },
  italic: {
    fontStyle: 'italic',
    color: colors.text,
  },
  underline: {
    textDecorationLine: 'underline',
    color: colors.text,
  },
  bullet: {
    fontWeight: 'bold',
    color: colors.primary,
  },
});
