// Node shapes per notation: each one measures itself (for the layout) and
// draws itself into a rectangle the layout chose.
import type { DiagramKind, DiagramNode, Member } from '../../model/types';
import { formatAttribute, formatOperation } from '../../model/format';
import type { Rect, Size } from '../../layout/types';
import type { Prim } from '../scene';
import { textWidth, wrap, type Font } from '../text';
import type { Theme } from '../themes';

export type Locale = 'pt' | 'en';

export interface NodeShape {
  size: Size;
  draw(r: Rect): { body: Prim[]; text: Prim[] };
  /** Relational: x of each column's cell centre, relative to the node. */
  columnX?: Map<string, number>;
  /** Chen: ellipse size per attribute. */
  attributeSizes?: Size[];
  aria: string;
}

const COLLAPSE_AT = 10;
const SHOW_WHEN_COLLAPSED = 8;

const words = {
  pt: {
    more: (n: number, what: 'attr' | 'op') =>
      `+ ${n} ${what === 'op' ? (n === 1 ? 'método' : 'métodos') : n === 1 ? 'atributo' : 'atributos'}`,
    kinds: {
      class: 'Classe',
      interface: 'Interface',
      abstract: 'Classe abstrata',
      enum: 'Enumeração',
      record: 'Record',
      package: 'Pacote',
      struct: 'Estrutura',
      union: 'União',
      typedef: 'Tipo',
      'c-enum': 'Enumeração',
      'source-file': 'Ficheiro',
      'header-file': 'Cabeçalho',
      function: 'Função',
      script: 'Script',
      external: 'Externo',
      table: 'Tabela',
      view: 'Vista',
      entity: 'Entidade',
      'weak-entity': 'Entidade fraca',
      relationship: 'Relação',
      'identifying-relationship': 'Relação identificadora',
      terminator: 'Terminal',
      process: 'Processo',
      decision: 'Decisão',
      io: 'Entrada/saída',
      subroutine: 'Subrotina',
      connector: 'Conector',
    } as Record<string, string>,
    attrs: (n: number) => `${n} ${n === 1 ? 'atributo' : 'atributos'}`,
    ops: (n: number) => `${n} ${n === 1 ? 'operação' : 'operações'}`,
    cols: (n: number) => `${n} ${n === 1 ? 'coluna' : 'colunas'}`,
  },
  en: {
    more: (n: number, what: 'attr' | 'op') =>
      `+ ${n} ${what === 'op' ? (n === 1 ? 'method' : 'methods') : n === 1 ? 'attribute' : 'attributes'}`,
    kinds: {
      class: 'Class',
      interface: 'Interface',
      abstract: 'Abstract class',
      enum: 'Enumeration',
      record: 'Record',
      package: 'Package',
      struct: 'Struct',
      union: 'Union',
      typedef: 'Type',
      'c-enum': 'Enumeration',
      'source-file': 'File',
      'header-file': 'Header',
      function: 'Function',
      script: 'Script',
      external: 'External',
      table: 'Table',
      view: 'View',
      entity: 'Entity',
      'weak-entity': 'Weak entity',
      relationship: 'Relationship',
      'identifying-relationship': 'Identifying relationship',
      terminator: 'Terminator',
      process: 'Process',
      decision: 'Decision',
      io: 'Input/output',
      subroutine: 'Subroutine',
      connector: 'Connector',
    } as Record<string, string>,
    attrs: (n: number) => `${n} attribute${n === 1 ? '' : 's'}`,
    ops: (n: number) => `${n} operation${n === 1 ? '' : 's'}`,
    cols: (n: number) => `${n} column${n === 1 ? '' : 's'}`,
  },
};

const baseline = (centerY: number, size: number) => centerY + size * 0.35;

function font(theme: Theme, size: number, weight = 400, mono = false): Font {
  return { size, weight, family: theme.fontClass === 'hand' ? 'hand' : mono ? 'mono' : 'sans' };
}

function txt(
  theme: Theme,
  x: number,
  y: number,
  text: string,
  size: number,
  opts: Partial<Extract<Prim, { t: 'text' }>> = {},
): Prim {
  return { t: 'text', x, y, text, size, anchor: 'start', fill: theme.text, family: 'sans', ...opts };
}

// ---------------------------------------------------------------------------
// UML classifier (Java classes, C structs)

function umlBox(n: DiagramNode, theme: Theme, locale: Locale, kind: DiagramKind): NodeShape {
  const s = theme.size;
  const pad = 10;
  const stereo = n.stereotypes ?? [];
  const stereoText = stereo.length ? `«${stereo.join(', ')}»` : '';
  const name = n.label ?? n.name;
  const italic = n.kind === 'abstract' || n.kind === 'interface';
  const full = n.attributes !== undefined || n.operations !== undefined;
  const collapse = (list: Member[] | undefined, what: 'attr' | 'op', fmt: (m: Member) => string) => {
    const all = list ?? [];
    const shown = all.length > COLLAPSE_AT ? all.slice(0, SHOW_WHEN_COLLAPSED) : all;
    const rows = shown.map((m) => ({ text: fmt(m), m }));
    const more = all.length - shown.length;
    return { rows, more: more ? words[locale].more(more, what) : undefined };
  };
  const attrs = collapse(n.attributes, 'attr', formatAttribute);
  const ops = collapse(n.operations, 'op', formatOperation);
  const memberFont = font(theme, s.member);
  const nameFont = font(theme, s.name, 700);
  const stereoFont = font(theme, s.stereo);
  const rowH = Math.round(s.member * 1.8);
  const widths = [
    textWidth(name, nameFont),
    stereoText ? textWidth(stereoText, stereoFont) : 0,
    ...attrs.rows.map((r) => textWidth(r.text, memberFont)),
    ...ops.rows.map((r) => textWidth(r.text, memberFont)),
    attrs.more ? textWidth(attrs.more, memberFont) : 0,
    ops.more ? textWidth(ops.more, memberFont) : 0,
  ];
  const width = Math.max(kind === 'c.struct' ? 140 : 120, Math.max(...widths) + 2 * pad + 6);
  const headerH = 8 + (stereoText ? s.stereo + 4 : 0) + Math.round(s.name * 1.3) + 8;
  const compH = (c: typeof attrs) => {
    const count = c.rows.length + (c.more ? 1 : 0);
    return count ? 6 + count * rowH + 2 : 14;
  };
  const height = full ? headerH + compH(attrs) + compH(ops) : headerH + 6;
  const k = words[locale];
  const aria = `${k.kinds[n.kind] ?? n.kind} ${name}${full ? `, ${k.attrs(n.attributes?.length ?? 0)}, ${k.ops(n.operations?.length ?? 0)}` : ''}`;
  return {
    size: { width, height },
    aria,
    draw(r) {
      const sw = theme.strokeWidth;
      const fill = theme.fills.classifier;
      const body: Prim[] = [{ t: 'rect', x: r.x, y: r.y, w: r.width, h: r.height, fill, stroke: theme.stroke, sw }];
      const text: Prim[] = [];
      let y = r.y + 8;
      const cx = r.x + r.width / 2;
      if (stereoText) {
        text.push(txt(theme, cx, baseline(y + s.stereo / 2, s.stereo), stereoText, s.stereo, { anchor: 'middle' }));
        y += s.stereo + 4;
      }
      const nameH = Math.round(s.name * 1.3);
      text.push(
        txt(theme, cx, baseline(y + nameH / 2, s.name), name, s.name, { anchor: 'middle', weight: 700, italic }),
      );
      if (!full) return { body, text };
      const hy = r.y + headerH;
      const ay = hy + compH(attrs);
      body.push(
        {
          t: 'poly',
          pts: [
            { x: r.x, y: hy },
            { x: r.x + r.width, y: hy },
          ],
          fill: 'none',
          stroke: theme.stroke,
          sw,
        },
        {
          t: 'poly',
          pts: [
            { x: r.x, y: ay },
            { x: r.x + r.width, y: ay },
          ],
          fill: 'none',
          stroke: theme.stroke,
          sw,
        },
      );
      const rows = (c: typeof attrs, top: number, kindOf: 'attr' | 'op') => {
        let yy = top + 6;
        for (const row of c.rows) {
          const flags = row.m.flags ?? [];
          text.push(
            txt(theme, r.x + pad, baseline(yy + rowH / 2, s.member), row.text, s.member, {
              underline: flags.includes('static') ? 'solid' : undefined,
              italic: kindOf === 'op' && flags.includes('abstract'),
            }),
          );
          yy += rowH;
        }
        if (c.more)
          text.push(
            txt(theme, r.x + pad, baseline(yy + rowH / 2, s.member), c.more, s.member, {
              fill: theme.muted,
              italic: true,
            }),
          );
      };
      rows(attrs, hy, 'attr');
      rows(ops, ay, 'op');
      return { body, text };
    },
  };
}

// ---------------------------------------------------------------------------
// Graph nodes (call graphs, includes, packages, dependencies)

function graphBox(n: DiagramNode, theme: Theme, locale: Locale, kind: DiagramKind): NodeShape {
  const s = theme.size;
  const name = n.label ?? n.name;
  const mono = n.kind === 'function' || n.kind === 'external' || n.kind === 'source-file' || n.kind === 'header-file';
  const f = font(theme, s.member, n.kind === 'package' ? 700 : 500, mono);
  const stereo =
    n.kind === 'script'
      ? '«script»'
      : n.kind === 'interface'
        ? '«interface»'
        : n.kind === 'enum'
          ? '«enumeration»'
          : '';
  const tw = textWidth(name, f);
  const isFile = n.kind === 'source-file' || n.kind === 'header-file' || n.kind === 'io';
  const tab = n.kind === 'package' ? 16 : 0;
  const width = Math.max(kind === 'java.package' ? 150 : 96, tw + 32 + (isFile ? 10 : 0));
  const height = (n.kind === 'package' ? 56 : stereo ? 48 : 36) + tab;
  const external = n.kind === 'external';
  const k = words[locale];
  return {
    size: { width, height },
    aria: `${k.kinds[n.kind] ?? n.kind} ${name}`,
    draw(r) {
      const sw = theme.strokeWidth;
      const stroke = external ? theme.muted : theme.stroke;
      const fill = external
        ? theme.fills.external
        : n.kind === 'header-file'
          ? theme.fills.header2
          : isFile
            ? theme.fills.file
            : theme.fills.classifier;
      const body: Prim[] = [];
      if (n.kind === 'package') {
        const tw2 = Math.min(r.width * 0.4, 64);
        body.push(
          { t: 'rect', x: r.x, y: r.y, w: tw2, h: tab + 1, fill, stroke, sw },
          { t: 'rect', x: r.x, y: r.y + tab, w: r.width, h: r.height - tab, fill, stroke, sw },
        );
      } else if (isFile) {
        const ear = 10;
        body.push({
          t: 'poly',
          closed: true,
          pts: [
            { x: r.x, y: r.y },
            { x: r.x + r.width - ear, y: r.y },
            { x: r.x + r.width, y: r.y + ear },
            { x: r.x + r.width, y: r.y + r.height },
            { x: r.x, y: r.y + r.height },
          ],
          fill,
          stroke,
          sw,
        });
        body.push({
          t: 'poly',
          pts: [
            { x: r.x + r.width - ear, y: r.y },
            { x: r.x + r.width - ear, y: r.y + ear },
            { x: r.x + r.width, y: r.y + ear },
          ],
          fill: 'none',
          stroke,
          sw,
        });
      } else {
        body.push({
          t: 'rect',
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          rx: n.kind === 'function' || external ? 6 : 0,
          fill,
          stroke,
          sw,
          dash: external ? '5 4' : undefined,
        });
      }
      const text: Prim[] = [];
      const cx = r.x + r.width / 2;
      const top = r.y + tab;
      const h = r.height - tab;
      if (stereo) {
        text.push(
          txt(theme, cx, baseline(top + h / 2 - 8, s.stereo), stereo, s.stereo, { anchor: 'middle', fill: theme.text }),
        );
        text.push(
          txt(theme, cx, baseline(top + h / 2 + 8, s.member), name, s.member, { anchor: 'middle', weight: 600 }),
        );
      } else {
        text.push(
          txt(theme, cx - (isFile ? 4 : 0), baseline(top + h / 2, s.member), name, s.member, {
            anchor: 'middle',
            weight: n.kind === 'package' ? 700 : 500,
            family: mono ? 'mono' : 'sans',
            fill: external ? theme.muted : theme.text,
          }),
        );
      }
      return { body, text };
    },
  };
}

// ---------------------------------------------------------------------------
// Flowchart (ISO 5807)

function flowShape(n: DiagramNode, theme: Theme, locale: Locale): NodeShape {
  const size = theme.size.flow;
  const raw = (n.label ?? n.name).trim();
  const f = font(theme, size);
  const k = words[locale];
  const kind = n.kind;
  const maxText = kind === 'decision' ? 200 : 260;
  const lines = wrap(raw, f, maxText, kind === 'process' || kind === 'io' ? 3 : 2);
  const tw = Math.max(40, ...lines.map((l) => textWidth(l, f)));
  const lineH = Math.round(size * 1.25);
  const th = lines.length * lineH;
  let width: number;
  let height: number;
  switch (kind) {
    case 'terminator':
      height = Math.max(40, th + 16);
      width = Math.max(120, tw + height + 8);
      break;
    case 'decision':
      height = Math.max(72, th * 1.6 + 24);
      width = Math.max(176, Math.min(300, Math.max(tw * 1.7 + 24, height * 2.4)));
      break;
    case 'io':
      height = Math.max(48, th + 20);
      width = Math.max(160, tw + 56);
      break;
    case 'connector':
      height = width = Math.max(32, tw + 12);
      break;
    default:
      height = Math.max(48, th + 20);
      width = Math.max(160, tw + (kind === 'subroutine' ? 48 : 32));
  }
  width = Math.ceil(width);
  height = Math.ceil(height);
  return {
    size: { width, height },
    aria: `${k.kinds[kind] ?? kind}: ${lines.join(' ')}`,
    draw(r) {
      const sw = theme.strokeWidth * 0.8 + 0.2;
      const fill = theme.fills.flow;
      const stroke = theme.id === 'vp' ? '#000000' : theme.stroke;
      const body: Prim[] = [];
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      switch (kind) {
        case 'terminator':
          body.push({ t: 'rect', x: r.x, y: r.y, w: r.width, h: r.height, rx: r.height / 2, fill, stroke, sw });
          break;
        case 'decision':
          body.push({
            t: 'poly',
            closed: true,
            pts: [
              { x: cx, y: r.y },
              { x: r.x + r.width, y: cy },
              { x: cx, y: r.y + r.height },
              { x: r.x, y: cy },
            ],
            fill,
            stroke,
            sw,
          });
          break;
        case 'io': {
          const skew = 14;
          body.push({
            t: 'poly',
            closed: true,
            pts: [
              { x: r.x + skew, y: r.y },
              { x: r.x + r.width, y: r.y },
              { x: r.x + r.width - skew, y: r.y + r.height },
              { x: r.x, y: r.y + r.height },
            ],
            fill,
            stroke,
            sw,
          });
          break;
        }
        case 'connector':
          body.push({ t: 'ellipse', cx, cy, rx: r.width / 2, ry: r.height / 2, fill, stroke, sw });
          break;
        case 'subroutine':
          body.push(
            { t: 'rect', x: r.x, y: r.y, w: r.width, h: r.height, fill, stroke, sw },
            {
              t: 'poly',
              pts: [
                { x: r.x + 10, y: r.y },
                { x: r.x + 10, y: r.y + r.height },
              ],
              fill: 'none',
              stroke,
              sw,
            },
            {
              t: 'poly',
              pts: [
                { x: r.x + r.width - 10, y: r.y },
                { x: r.x + r.width - 10, y: r.y + r.height },
              ],
              fill: 'none',
              stroke,
              sw,
            },
          );
          break;
        default:
          body.push({ t: 'rect', x: r.x, y: r.y, w: r.width, h: r.height, fill, stroke, sw });
      }
      const top = cy - th / 2;
      const text = lines.map((l, i) =>
        txt(theme, cx, baseline(top + lineH * (i + 0.5), size), l, size, { anchor: 'middle' }),
      );
      return { body, text };
    },
  };
}

// ---------------------------------------------------------------------------
// Relational schema (FBD): name above a row of touching cells

function relationalTable(n: DiagramNode, theme: Theme, locale: Locale): NodeShape {
  const s = theme.size;
  const cellF = font(theme, s.cell, 700);
  const nameF = font(theme, s.table);
  const cols = n.attributes ?? [];
  const cellW = cols.map((c) => Math.max(100, textWidth(c.name, cellF) + 20));
  const nameH = Math.round(s.table * 1.5);
  const cellH = 40;
  const width = Math.max(
    cellW.reduce((a, b) => a + b, 0),
    textWidth(n.name, nameF) + 10,
    100,
  );
  const columnX = new Map<string, number>();
  let x = 0;
  cols.forEach((c, i) => {
    columnX.set(c.name, x + cellW[i]! / 2);
    x += cellW[i]!;
  });
  return {
    size: { width, height: nameH + cellH },
    columnX,
    aria: `${words[locale].kinds.table} ${n.name}, ${words[locale].cols(cols.length)}`,
    draw(r) {
      const sw = theme.strokeWidth;
      const body: Prim[] = [];
      const text: Prim[] = [txt(theme, r.x + 5, r.y + nameH - 8, n.name, s.table)];
      let cx = r.x;
      const y = r.y + nameH;
      cols.forEach((c, i) => {
        const w = cellW[i]!;
        body.push({ t: 'rect', x: cx, y, w, h: cellH, fill: theme.fills.body, stroke: theme.stroke, sw });
        const pk = c.flags?.includes('pk');
        text.push(
          txt(theme, cx + w / 2, baseline(y + cellH / 2, s.cell), c.name, s.cell, {
            anchor: 'middle',
            weight: 700,
            underline: pk ? 'solid' : undefined,
          }),
        );
        cx += w;
      });
      if (!cols.length)
        body.push({ t: 'rect', x: r.x, y, w: r.width, h: cellH, fill: theme.fills.body, stroke: theme.stroke, sw });
      return { body, text };
    },
  };
}

// ---------------------------------------------------------------------------
// SQL Server database diagram and crow's foot: a box with a header and one row per column

function columnBox(n: DiagramNode, theme: Theme, locale: Locale, crow: boolean): NodeShape {
  const s = theme.size;
  const cols = n.attributes ?? [];
  const nameF = font(theme, s.name, 700);
  const colF = font(theme, s.member);
  const rowH = Math.round(s.member * 1.75);
  const headH = Math.round(s.name * 1.9);
  const gutter = crow ? 34 : 28;
  const typeW = crow ? Math.max(0, ...cols.map((c) => (c.type ? textWidth(c.type, colF) : 0))) : 0;
  const width = Math.max(
    160,
    textWidth(n.name, nameF) + 24,
    ...cols.map((c) => gutter + textWidth(c.name, colF) + (typeW ? typeW + 28 : 16)),
  );
  const height = headH + cols.length * rowH + (crow ? 6 : rowH - 4) + 4;
  return {
    size: { width, height },
    aria: `${words[locale].kinds.table} ${n.name}, ${words[locale].cols(cols.length)}`,
    draw(r) {
      const body: Prim[] = [];
      const text: Prim[] = [];
      const o = theme.ssms;
      if (crow) {
        body.push(
          {
            t: 'rect',
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            fill: theme.fills.body,
            stroke: theme.stroke,
            sw: theme.strokeWidth,
          },
          {
            t: 'rect',
            x: r.x,
            y: r.y,
            w: r.width,
            h: headH,
            fill: theme.fills.header,
            stroke: theme.stroke,
            sw: theme.strokeWidth,
          },
        );
        text.push(
          txt(theme, r.x + r.width / 2, baseline(r.y + headH / 2, s.name), n.name, s.name, {
            anchor: 'middle',
            weight: 700,
          }),
        );
      } else {
        body.push(
          { t: 'rect', x: r.x, y: r.y, w: r.width, h: r.height, fill: o.band, stroke: o.outer, sw: 1 },
          {
            t: 'rect',
            x: r.x + 2,
            y: r.y + headH,
            w: r.width - 4,
            h: r.height - headH - 2,
            fill: theme.fills.body,
            stroke: o.inner,
            sw: 1,
          },
        );
        text.push(txt(theme, r.x + 8, baseline(r.y + headH / 2, s.name), n.name, s.name, { weight: 700 }));
      }
      cols.forEach((c, i) => {
        const y = r.y + headH + 3 + i * rowH;
        const flags = c.flags ?? [];
        if (!crow && i > 0) {
          body.push({
            t: 'poly',
            pts: [
              { x: r.x + 2, y },
              { x: r.x + r.width - 2, y },
            ],
            fill: 'none',
            stroke: o.band,
            sw: 1,
          });
        }
        if (crow) {
          const tag = flags.includes('pk') ? (flags.includes('fk') ? 'PF' : 'PK') : flags.includes('fk') ? 'FK' : '';
          if (tag)
            text.push(
              txt(theme, r.x + 8, baseline(y + rowH / 2, s.stereo), tag, s.stereo, { weight: 700, family: 'mono' }),
            );
          text.push(
            txt(theme, r.x + gutter, baseline(y + rowH / 2, s.member), c.name, s.member, {
              underline: flags.includes('pk') ? 'solid' : undefined,
            }),
          );
          if (c.type)
            text.push(
              txt(theme, r.x + r.width - 8, baseline(y + rowH / 2, s.member), c.type, s.member, {
                anchor: 'end',
                fill: theme.muted,
              }),
            );
        } else {
          if (flags.includes('pk')) body.push(...keyIcon(r.x + 10, y + rowH / 2, o.key, 1));
          text.push(txt(theme, r.x + gutter, baseline(y + rowH / 2, s.member), c.name, s.member));
        }
      });
      return { body, text };
    },
  };
}

/** The yellow SQL Server key, centred at (x, y), pointing right. */
export function keyIcon(x: number, y: number, fill: string, scale: number): Prim[] {
  const r = 3.2 * scale;
  const len = 9 * scale;
  return [
    { t: 'ellipse', cx: x - len / 2 + r, cy: y, rx: r, ry: r, fill, stroke: '#000000', sw: 0.8 },
    {
      t: 'poly',
      closed: true,
      pts: [
        { x: x - len / 2 + 2 * r - 0.5, y: y - 1.2 * scale },
        { x: x + len / 2, y: y - 1.2 * scale },
        { x: x + len / 2, y: y + 2.6 * scale },
        { x: x + len / 2 - 1.8 * scale, y: y + 2.6 * scale },
        { x: x + len / 2 - 1.8 * scale, y: y + 1.2 * scale },
        { x: x - len / 2 + 2 * r - 0.5, y: y + 1.2 * scale },
      ],
      fill,
      stroke: '#000000',
      sw: 0.8,
    },
  ];
}

// ---------------------------------------------------------------------------
// Chen

function chenShape(n: DiagramNode, theme: Theme, locale: Locale): NodeShape {
  const s = theme.size;
  const name = n.label ?? n.name;
  const diamond = n.kind === 'relationship' || n.kind === 'identifying-relationship';
  const double = n.kind === 'weak-entity' || n.kind === 'identifying-relationship';
  const nameF = font(theme, s.member, diamond ? 400 : 700);
  const tw = textWidth(name, nameF);
  const size = diamond
    ? { width: Math.max(104, Math.round(tw * 1.7 + 28)), height: Math.max(52, Math.round(tw * 0.35 + 36)) }
    : { width: Math.max(130, tw + 36), height: 60 };
  const attrF = font(theme, s.cell);
  const attrs = n.attributes ?? [];
  const attrLines = attrs.map((a) =>
    wrap(a.name.replace(/_/g, ' '), attrF, 90, 2).map((l) => l.replace(/ /g, a.name.includes('_') ? '_' : ' ')),
  );
  const attributeSizes = attrLines.map((lines) => ({
    width: Math.max(84, Math.max(...lines.map((l) => textWidth(l, attrF))) + 30),
    height: lines.length > 1 ? 48 : 40,
  }));
  return {
    size,
    attributeSizes,
    aria: `${words[locale].kinds[n.kind] ?? n.kind} ${name}${attrs.length ? `, ${words[locale].attrs(attrs.length)}` : ''}`,
    draw(r) {
      const sw = theme.strokeWidth;
      const fill = diamond ? theme.fills.relationship : theme.fills.entity;
      const body: Prim[] = [];
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const shape = (inset: number): Prim =>
        diamond
          ? {
              t: 'poly',
              closed: true,
              pts: [
                { x: cx, y: r.y + inset },
                { x: r.x + r.width - inset * 1.6, y: cy },
                { x: cx, y: r.y + r.height - inset },
                { x: r.x + inset * 1.6, y: cy },
              ],
              fill: inset ? 'none' : fill,
              stroke: theme.stroke,
              sw,
            }
          : {
              t: 'rect',
              x: r.x + inset,
              y: r.y + inset,
              w: r.width - 2 * inset,
              h: r.height - 2 * inset,
              fill: inset ? 'none' : fill,
              stroke: theme.stroke,
              sw,
            };
      body.push(shape(0));
      if (double) body.push(shape(5));
      const text: Prim[] = [
        txt(theme, cx, baseline(cy, s.member), name, s.member, { anchor: 'middle', weight: diamond ? 400 : 700 }),
      ];
      return { body, text };
    },
  };
}

/** Draws attribute ellipses of a Chen node at the positions the layout gave. */
export function chenAttributes(n: DiagramNode, theme: Theme, rects: readonly Rect[]): { body: Prim[]; text: Prim[] } {
  const s = theme.size;
  const attrF = font(theme, s.cell);
  const body: Prim[] = [];
  const text: Prim[] = [];
  (n.attributes ?? []).forEach((a, i) => {
    const r = rects[i];
    if (!r) return;
    const flags = a.flags ?? [];
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    body.push({
      t: 'ellipse',
      cx,
      cy,
      rx: r.width / 2,
      ry: r.height / 2,
      fill: theme.fills.attribute,
      stroke: theme.stroke,
      sw: theme.strokeWidth,
    });
    if (flags.includes('multivalued')) {
      body.push({
        t: 'ellipse',
        cx,
        cy,
        rx: r.width / 2 - 4,
        ry: r.height / 2 - 4,
        fill: 'none',
        stroke: theme.stroke,
        sw: theme.strokeWidth,
      });
    }
    const lines = wrap(a.name.replace(/_/g, ' '), attrF, 90, 2).map((l) =>
      l.replace(/ /g, a.name.includes('_') ? '_' : ' '),
    );
    const lineH = Math.round(s.cell * 1.25);
    const top = cy - (lines.length * lineH) / 2;
    lines.forEach((l, k) =>
      text.push(
        txt(theme, cx, baseline(top + lineH * (k + 0.5), s.cell), l, s.cell, {
          anchor: 'middle',
          underline: flags.includes('pk') ? 'solid' : flags.includes('partial-key') ? 'dashed' : undefined,
        }),
      ),
    );
  });
  return { body, text };
}

// ---------------------------------------------------------------------------

export function nodeShape(n: DiagramNode, kind: DiagramKind, theme: Theme, locale: Locale): NodeShape {
  switch (kind) {
    case 'java.class':
    case 'c.struct':
      return umlBox(n, theme, locale, kind);
    case 'bash.flowchart':
      return flowShape(n, theme, locale);
    case 'sql.relational':
      return relationalTable(n, theme, locale);
    case 'sql.ssms':
      return columnBox(n, theme, locale, false);
    case 'sql.crowsfoot':
      return columnBox(n, theme, locale, true);
    case 'sql.chen':
      return chenShape(n, theme, locale);
    default:
      return graphBox(n, theme, locale, kind);
  }
}
