import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Theme, useTheme } from '@/lib/theme';

/**
 * Just enough markdown for the grammar lessons: `# heading`, `- bullet`,
 * paragraphs, and inline **bold** / *italic*. Arabic inside a line is set in
 * the system font — the lessons mix scripts mid-sentence, where the mushaf
 * face would jar.
 */
export function Markdown({ text, scale = 1 }: { text: string; scale?: number }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme, scale), [theme, scale]);

  const blocks = useMemo(() => parse(text), [text]);

  return (
    <View>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <Text key={i} style={styles.heading}>
              {inline(block.text, styles)}
            </Text>
          );
        }
        if (block.kind === 'bullets') {
          return (
            <View key={i} style={styles.list}>
              {block.items.map((item, j) => (
                <View key={j} style={styles.bullet}>
                  <Text style={styles.dot}>•</Text>
                  <Text style={styles.paragraph}>{inline(item, styles)}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (block.kind === 'numbered') {
          return (
            <View key={i} style={styles.list}>
              {block.items.map((item, j) => (
                <View key={j} style={styles.bullet}>
                  <Text style={styles.dot}>{j + 1}.</Text>
                  <Text style={styles.paragraph}>{inline(item, styles)}</Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={styles.paragraph}>
            {inline(block.text, styles)}
          </Text>
        );
      })}
    </View>
  );
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^#+\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1] });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'bullets') last.items.push(bullet[1]);
      else blocks.push({ kind: 'bullets', items: [bullet[1]] });
      continue;
    }
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'numbered') last.items.push(numbered[1]);
      else blocks.push({ kind: 'numbered', items: [numbered[1]] });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Split on **bold** and *italic* runs; everything else is plain text. */
function inline(text: string, styles: ReturnType<typeof makeStyles>) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p.length > 0);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={i} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <Text key={i} style={styles.italic}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    return part;
  });
}

function makeStyles(theme: Theme, scale: number) {
  const size = (n: number) => Math.round(n * scale);
  return StyleSheet.create({
    heading: {
      fontSize: size(17),
      lineHeight: size(24),
      fontWeight: '700',
      color: theme.text,
      marginTop: 18,
      marginBottom: 6,
    },
    paragraph: {
      flex: 1,
      fontSize: size(16),
      lineHeight: size(27),
      color: theme.text,
      marginBottom: 8,
    },
    list: { marginBottom: 4 },
    bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    dot: { fontSize: size(16), lineHeight: size(27), color: theme.textMuted, minWidth: 14 },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic', color: theme.textMuted },
  });
}
