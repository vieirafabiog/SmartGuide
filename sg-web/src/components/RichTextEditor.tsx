// ==============================================================================
// Componente: RichTextEditor (Editor WYSIWYG Formatado em Tempo Real)
// Réplica fiel do componente RichTextEditor do Power Apps:
// Mostra o texto já formatado visualmente enquanto o usuário digita (sem exibir tags HTML)
// ==============================================================================

import React, { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { sanitizeRichTextHtml } from '../utils/htmlSanitizer';

interface RichTextEditorProps {
  value: string;
  onChangeText: (html: string) => void;
  placeholder?: string;
  label?: string;
  minHeight?: number;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChangeText,
  placeholder = 'Escreva e formate seu texto aqui...',
  label,
  minHeight = 160,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Sincroniza o valor inicial ou externo com o conteúdo sanitizado no editor WYSIWYG
  useEffect(() => {
    if (Platform.OS === 'web' && editorRef.current) {
      const sanitized = sanitizeRichTextHtml(value || '');
      if (editorRef.current.innerHTML !== sanitized) {
        editorRef.current.innerHTML = sanitized;
      }
    }
  }, [value]);

  // Executa comandos de formatação visual padrão do navegador (WYSIWYG)
  const executeCommand = (command: string, arg: string | undefined = undefined) => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      editorRef.current?.focus();
      document.execCommand(command, false, arg);
      if (editorRef.current) {
        onChangeText(sanitizeRichTextHtml(editorRef.current.innerHTML));
      }
    }
  };

  const handleInput = () => {
    if (Platform.OS === 'web' && editorRef.current) {
      onChangeText(sanitizeRichTextHtml(editorRef.current.innerHTML));
    }
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}

      {/* Barra de Ferramentas WYSIWYG */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('bold')}
          accessibilityLabel="Negrito"
        >
          <Text style={[styles.toolBtnText, { fontWeight: 'bold' }]}>B</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('italic')}
          accessibilityLabel="Itálico"
        >
          <Text style={[styles.toolBtnText, { fontStyle: 'italic', fontWeight: '600' }]}>I</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('underline')}
          accessibilityLabel="Sublinhado"
        >
          <Text style={[styles.toolBtnText, { textDecorationLine: 'underline', fontWeight: '600' }]}>
            U
          </Text>
        </TouchableOpacity>

        <View style={styles.separator} />

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('formatBlock', '<h2>')}
          accessibilityLabel="Título 2"
        >
          <Text style={[styles.toolBtnText, { fontWeight: '700' }]}>H2</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('formatBlock', '<h3>')}
          accessibilityLabel="Título 3"
        >
          <Text style={[styles.toolBtnText, { fontWeight: '700' }]}>H3</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('formatBlock', '<p>')}
          accessibilityLabel="Parágrafo Normal"
        >
          <Text style={styles.toolBtnText}>P</Text>
        </TouchableOpacity>

        <View style={styles.separator} />

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('insertUnorderedList')}
          accessibilityLabel="Lista com Marcadores"
        >
          <Text style={styles.toolBtnText}>• Lista</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('insertOrderedList')}
          accessibilityLabel="Lista Numerada"
        >
          <Text style={styles.toolBtnText}>1. Lista</Text>
        </TouchableOpacity>

        <View style={styles.separator} />

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => executeCommand('removeFormat')}
          accessibilityLabel="Limpar Formatação"
        >
          <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Área de Edição Formatada (WYSIWYG) */}
      {Platform.OS === 'web' ? (
        <div
          ref={editorRef as any}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          data-placeholder={placeholder}
          style={{
            minHeight,
            padding: 14,
            outline: 'none',
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderBottomLeftRadius: 4,
            borderBottomRightRadius: 4,
            color: colors.text,
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            overflowY: 'auto',
          }}
        />
      ) : (
        <TextInput
          style={[styles.mobileInput, { minHeight }]}
          multiline
          textAlignVertical="top"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#EEEEEE',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomWidth: 0,
    padding: 6,
    alignItems: 'center',
    gap: 4,
  },
  toolBtn: {
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnText: {
    fontSize: 13,
    color: colors.text,
  },
  separator: {
    width: 1,
    height: 20,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  mobileInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    padding: 12,
    fontSize: 14,
    color: colors.text,
  },
});
