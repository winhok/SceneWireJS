import type { VideoProject } from '@scenewirejs/schema';
export interface ResolvedTheme {
  id: string;
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  danger: string;
  warning: string;
  success: string;
  typography: { primary: string; mono: string };
  diagram: {
    nodeFill: string;
    nodeStroke: string;
    edge: string;
    active: string;
  };
  annotation: { stroke: string; text: string };
  style: 'dark-tech' | 'paper-sketch' | 'editorial';
}
export const themeIds = ['dark-tech', 'paper-sketch', 'editorial'] as const;
const palettes = {
  editorial: {
    background: '#f4f1eb',
    foreground: '#242a34',
    muted: '#777e87',
    accent: '#6754d8',
    surface: '#fffdf9',
    surfaceAlt: '#e8e3f4',
    border: '#d8d3cb',
    danger: '#bf5b57',
    warning: '#b6853a',
    success: '#398773',
  },
  'dark-tech': {
    background: '#0b1220',
    foreground: '#e7edf7',
    muted: '#849fbd',
    accent: '#53d5b0',
    surface: '#152238',
    surfaceAlt: '#17283c',
    border: '#33516b',
    danger: '#ef817b',
    warning: '#f4c674',
    success: '#53d5b0',
  },
  'paper-sketch': {
    background: '#f6f0e2',
    foreground: '#343936',
    muted: '#77776b',
    accent: '#367e91',
    surface: '#eee5d0',
    surfaceAlt: '#e0eaf0',
    border: '#666c61',
    danger: '#c65e43',
    warning: '#d29442',
    success: '#527d63',
  },
};
/** Unknown legacy names explicitly use dark-tech; persisted palette/font overrides survive. */
export function resolveTheme(theme: VideoProject['theme']): ResolvedTheme {
  const id = themeIds.find((id) => id === theme.name) ?? 'dark-tech';
  const p = {
    ...palettes[id],
    foreground: theme.foreground,
    accent: theme.accent,
  };
  return {
    ...p,
    id,
    style: id,
    typography: {
      primary: theme.fontFamily,
      mono: 'ui-monospace, Menlo, monospace',
    },
    diagram: {
      nodeFill: p.surface,
      nodeStroke: p.border,
      edge: p.muted,
      active: p.accent,
    },
    annotation: { stroke: p.accent, text: p.foreground },
  };
}
export function themePreset(
  name: (typeof themeIds)[number],
): VideoProject['theme'] {
  return {
    name,
    fontFamily:
      name === 'paper-sketch'
        ? 'Georgia, serif'
        : 'Inter, system-ui, sans-serif',
    foreground: palettes[name].foreground,
    accent: palettes[name].accent,
  };
}
