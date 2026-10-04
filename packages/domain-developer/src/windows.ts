import type { Clip } from '@scenewirejs/schema';
import type { PrimitiveInstruction } from '@scenewirejs/runtime';
import type { HighlighterCore } from 'shiki/core';
import { box, text, withReveal } from './primitives';
export type CodeClip = Extract<Clip, { component: 'CodeWindow' }>;
export function createCodeCompiler(highlighter: HighlighterCore) {
  const cache = new Map<string, ReturnType<HighlighterCore['codeToTokens']>>();
  return (clip: CodeClip): PrimitiveInstruction[] => {
    const p = clip.props;
    const key = JSON.stringify([p.language, p.code]);
    let tokens = cache.get(key);
    if (!tokens) {
      tokens = highlighter.codeToTokens(p.code.replace(/\t/g, '  '), {
        lang: p.language,
        theme: 'github-dark',
        // A wall-clock deadline silently returns partial tokens and corrupts the
        // cached grammar state. Authored graph identity must not depend on CPU
        // speed or scheduling; the enclosing CLI process owns execution bounds.
        tokenizeTimeLimit: 0,
      });
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, tokens);
    }
    const w = clip.transform.width,
      h = clip.transform.height,
      size = p.fontSize,
      lineHeight = size * 1.5;
    const result = [
      box(`${clip.id}:window`, 0, 0, w, h, '#101b2b'),
      box(`${clip.id}:bar`, 1, 1, w - 2, 42, '#1c2b40', '#1c2b40', 12),
      text(`${clip.id}:filename`, p.filename, 20, 12, w - 40, 16, '#9eb8d4'),
    ];
    const visibleLines = Math.max(0, Math.floor((h - 60) / lineHeight));
    tokens.tokens.slice(0, visibleLines).forEach((line, index) => {
      const number = index + 1,
        y = 58 + index * lineHeight;
      const focused =
        !p.focusRegion ||
        (number >= p.focusRegion.startLine && number <= p.focusRegion.endLine);
      if (p.highlightedLines.includes(number))
        result.push(
          box(
            `${clip.id}:highlight-${number}`,
            8,
            y - 3,
            w - 16,
            lineHeight,
            '#23483f',
            '#23483f',
            3,
          ),
        );
      if (p.lineNumbers)
        result.push(
          text(
            `${clip.id}:number-${number}`,
            String(number),
            14,
            y,
            36,
            size,
            '#5e7895',
            lineHeight,
            true,
          ),
        );
      let x = p.lineNumbers ? 58 : 20;
      line.forEach((token, tokenIndex) => {
        const width =
          [...token.content].reduce(
            (sum, c) => sum + (c.codePointAt(0)! > 0x2e7f ? 2 : 1),
            0,
          ) *
          size *
          0.602;
        if (width > 0) {
          const value = text(
            `${clip.id}:token-${number}-${tokenIndex}`,
            token.content,
            x,
            y,
            width + 1,
            size,
            token.color ?? '#c8d4e5',
            lineHeight,
            true,
          );
          result.push({
            ...value,
            transform: { ...value.transform, opacity: focused ? 1 : 0.32 },
          });
        }
        x += width;
      });
    });
    return result;
  };
}
export function compileTerminal(
  clip: Extract<Clip, { component: 'Terminal' }>,
): PrimitiveInstruction[] {
  const p = clip.props,
    w = clip.transform.width,
    h = clip.transform.height;
  const result = [
    box(`${clip.id}:window`, 0, 0, w, h, '#101923'),
    text(`${clip.id}:title`, p.title, 20, 14, w - 40, 16, '#819ebc'),
  ];
  let y = 58;
  const total = p.entries.length * 2 + 1;
  p.entries.forEach((entry, index) => {
    let command = text(
      `${clip.id}:command-${index}`,
      `$ ${entry.command}`,
      20,
      y,
      w - 40,
      p.fontSize,
      '#7fddbd',
      p.fontSize * 1.5,
      true,
    );
    y += p.fontSize * 1.6;
    const lines = entry.output.split('\n').length;
    let output = text(
      `${clip.id}:output-${index}`,
      entry.output,
      20,
      y,
      w - 40,
      p.fontSize,
      entry.status === 'error'
        ? '#f59494'
        : entry.status === 'success'
          ? '#7fddbd'
          : '#a9bdd1',
      lines * p.fontSize * 1.4,
      true,
    );
    y += lines * p.fontSize * 1.4 + 18;
    if (p.reveal) {
      command = withReveal(
        command,
        (index * 2) / total,
        (index * 2 + 0.8) / total,
        'type',
      );
      output = withReveal(
        output,
        (index * 2 + 1) / total,
        (index * 2 + 1.8) / total,
        'type',
      );
    }
    result.push(command, output);
  });
  return result;
}
export function compileBrowser(
  clip: Extract<Clip, { component: 'BrowserFrame' }>,
): PrimitiveInstruction[] {
  const p = clip.props,
    w = clip.transform.width,
    h = clip.transform.height;
  return [
    box(`${clip.id}:window`, 0, 0, w, h),
    box(`${clip.id}:bar`, 1, 1, w - 2, 48, '#1c2b40', '#1c2b40'),
    text(`${clip.id}:url`, p.url, 20, 16, w - 40, 14, '#7899b8'),
    text(`${clip.id}:title`, p.title, 24, 72, w - 48, 16, '#53d5b0'),
    text(`${clip.id}:heading`, p.heading, 24, 114, w - 48, 28),
    text(`${clip.id}:body`, p.body, 24, 162, w - 48, 18, '#9cb2c9', h - 180),
  ];
}
