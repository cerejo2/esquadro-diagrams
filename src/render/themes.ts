// Diagram themes, with the values measured in docs/notacoes.md (scaled to 1x).
// A theme is only colours, type and stroke; the shapes come from the notations.
// It is independent of the UI's light/dark theme.
import type { DiagramKind } from '../model/types';
import type { FontClass } from './text';

export type ThemeId = 'vp' | 'ssms' | 'drawio-dark' | 'caderno';

export interface Theme {
  id: ThemeId;
  name: { pt: string; en: string };
  background: string;
  /** Squared paper (Caderno): grid pitch and line colour. */
  paper?: { pitch: number; line: string; margin?: string };
  fontClass: FontClass;
  fontFamily: string;
  /** Monospace for code-like labels (function names, flowchart commands). */
  monoFamily: string;
  text: string;
  muted: string;
  stroke: string;
  strokeWidth: number;
  /** Flow lines are a bit heavier than shape outlines (flowchart). */
  flowWidth: number;
  /** Corner radius of orthogonal edges. */
  edgeRadius: number;
  fills: {
    classifier: string;
    header: string;
    body: string;
    flow: string;
    external: string;
    entity: string;
    relationship: string;
    attribute: string;
    file: string;
    header2: string;
  };
  /** SQL Server specific. */
  ssms: { outer: string; inner: string; band: string; key: string };
  rough?: { roughness: number; bowing: number; strokeWidth: number };
  size: { name: number; member: number; stereo: number; label: number; flow: number; cell: number; table: number };
}

const SANS = "'Segoe UI', 'DejaVu Sans', Verdana, Arial, sans-serif";
const MONO = "'JetBrains Mono', Consolas, 'DejaVu Sans Mono', monospace";

export const THEMES: Record<ThemeId, Theme> = {
  vp: {
    id: 'vp',
    name: { pt: 'Visual Paradigm', en: 'Visual Paradigm' },
    background: '#ffffff',
    fontClass: 'sans',
    fontFamily: SANS,
    monoFamily: MONO,
    text: '#000000',
    muted: '#6b7280',
    stroke: '#1f3864',
    strokeWidth: 1.5,
    flowWidth: 1.6,
    edgeRadius: 4,
    fills: {
      classifier: '#87ceeb',
      header: '#87ceeb',
      body: '#87ceeb',
      flow: '#9fcdf5',
      external: '#e5e7eb',
      entity: '#87ceeb',
      relationship: '#cfeaf6',
      attribute: '#ffffff',
      file: '#87ceeb',
      header2: '#cfeaf6',
    },
    ssms: { outer: '#646464', inner: '#a0a0a0', band: '#f0f0f0', key: '#ffff00' },
    size: { name: 14, member: 13, stereo: 11, label: 12, flow: 14, cell: 11, table: 18 },
  },
  ssms: {
    id: 'ssms',
    name: { pt: 'SQL Server', en: 'SQL Server' },
    background: '#ffffff',
    fontClass: 'sans',
    fontFamily: "'Segoe UI', Arial, sans-serif",
    monoFamily: MONO,
    text: '#000000',
    muted: '#646464',
    stroke: '#646464',
    strokeWidth: 1,
    flowWidth: 1.4,
    edgeRadius: 0,
    fills: {
      classifier: '#ffffff',
      header: '#f0f0f0',
      body: '#ffffff',
      flow: '#ffffff',
      external: '#f0f0f0',
      entity: '#ffffff',
      relationship: '#f0f0f0',
      attribute: '#ffffff',
      file: '#ffffff',
      header2: '#f0f0f0',
    },
    ssms: { outer: '#646464', inner: '#a0a0a0', band: '#f0f0f0', key: '#ffff00' },
    size: { name: 14, member: 12, stereo: 11, label: 12, flow: 13, cell: 11, table: 16 },
  },
  'drawio-dark': {
    id: 'drawio-dark',
    name: { pt: 'draw.io escuro', en: 'draw.io dark' },
    background: '#121212',
    fontClass: 'sans',
    fontFamily: 'Helvetica, Arial, sans-serif',
    monoFamily: MONO,
    text: '#ffffff',
    muted: '#a3a3a3',
    stroke: '#ffffff',
    strokeWidth: 1,
    flowWidth: 1.3,
    edgeRadius: 0,
    fills: {
      classifier: '#121212',
      header: '#121212',
      body: '#121212',
      flow: '#121212',
      external: '#262626',
      entity: '#121212',
      relationship: '#121212',
      attribute: '#121212',
      file: '#121212',
      header2: '#1e1e1e',
    },
    ssms: { outer: '#ffffff', inner: '#a3a3a3', band: '#1e1e1e', key: '#facc15' },
    size: { name: 13, member: 12, stereo: 11, label: 12, flow: 13, cell: 11, table: 20 },
  },
  caderno: {
    id: 'caderno',
    name: { pt: 'Caderno', en: 'Notebook' },
    background: '#fdfcf7',
    paper: { pitch: 16, line: 'rgba(59, 130, 246, 0.16)', margin: 'rgba(239, 68, 68, 0.35)' },
    fontClass: 'hand',
    fontFamily: "'Patrick Hand', 'Comic Sans MS', cursive",
    monoFamily: "'Patrick Hand', 'Comic Sans MS', cursive",
    text: '#1e2a5a',
    muted: '#6b7280',
    stroke: '#1e2a5a',
    strokeWidth: 1.4,
    flowWidth: 1.5,
    edgeRadius: 0,
    fills: {
      classifier: 'none',
      header: 'none',
      body: 'none',
      flow: 'none',
      external: 'none',
      entity: 'none',
      relationship: 'none',
      attribute: 'none',
      file: 'none',
      header2: 'none',
    },
    ssms: { outer: '#1e2a5a', inner: '#1e2a5a', band: 'none', key: '#facc15' },
    rough: { roughness: 1.1, bowing: 0.8, strokeWidth: 1.4 },
    size: { name: 17, member: 15, stereo: 13, label: 15, flow: 16, cell: 14, table: 22 },
  },
};

/** The theme that matches the reference notation of each kind. */
export function defaultTheme(kind: DiagramKind): ThemeId {
  switch (kind) {
    case 'sql.ssms':
    case 'sql.crowsfoot':
      return 'ssms';
    case 'sql.relational':
    case 'sql.chen':
      return 'drawio-dark';
    default:
      return 'vp';
  }
}
