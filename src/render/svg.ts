// Scene → standalone SVG string. The React canvas renders the same primitives
// with the same attributes (see primAttrs), so the export matches the screen.
import { polyPath } from './index';
import type { Prim, Scene } from './scene';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number) => Math.round(v * 100) / 100;

export type Attrs = Record<string, string | number | undefined>;

/** Element name and attributes of one primitive. Text content is returned separately. */
export function primAttrs(
  p: Prim,
  scene: Pick<Scene, 'fontFamily' | 'monoFamily'>,
): { tag: string; attrs: Attrs; text?: string } {
  switch (p.t) {
    case 'rect':
      return {
        tag: 'rect',
        attrs: {
          x: n2(p.x),
          y: n2(p.y),
          width: n2(p.w),
          height: n2(p.h),
          rx: p.rx ? n2(p.rx) : undefined,
          fill: p.fill,
          stroke: p.stroke,
          'stroke-width': p.sw,
          'stroke-dasharray': p.dash,
        },
      };
    case 'ellipse':
      return {
        tag: 'ellipse',
        attrs: {
          cx: n2(p.cx),
          cy: n2(p.cy),
          rx: n2(p.rx),
          ry: n2(p.ry),
          fill: p.fill,
          stroke: p.stroke,
          'stroke-width': p.sw,
        },
      };
    case 'poly':
      return {
        tag: 'path',
        attrs: {
          d: polyPath(p.pts, p.closed, p.radius ?? 0),
          fill: p.fill,
          stroke: p.stroke,
          'stroke-width': p.sw,
          'stroke-dasharray': p.dash,
          'stroke-linejoin': 'round',
          'stroke-linecap': p.closed ? undefined : 'round',
        },
      };
    case 'path':
      return {
        tag: 'path',
        attrs: {
          d: p.d,
          fill: p.fill,
          stroke: p.stroke,
          'stroke-width': p.sw,
          'stroke-dasharray': p.dash,
          'stroke-linecap': 'round',
        },
      };
    case 'text':
      return {
        tag: 'text',
        text: p.text,
        attrs: {
          x: n2(p.x),
          y: n2(p.y),
          'font-size': p.size,
          'font-family': p.family === 'mono' ? scene.monoFamily : scene.fontFamily,
          'font-weight': p.weight && p.weight !== 400 ? p.weight : undefined,
          'font-style': p.italic ? 'italic' : undefined,
          'text-decoration': p.underline ? 'underline' : undefined,
          'text-anchor': p.anchor === 'start' ? undefined : p.anchor,
          fill: p.fill,
          // Dashed underline (partial key) is drawn by the renderer as a separate line.
          'data-underline': p.underline === 'dashed' ? 'dashed' : undefined,
        },
      };
  }
}

function el(p: Prim, scene: Scene): string {
  const { tag, attrs, text } = primAttrs(p, scene);
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(' ');
  return text !== undefined ? `<${tag} ${a}>${esc(text)}</${tag}>` : `<${tag} ${a}/>`;
}

export function sceneToSvg(scene: Scene, title?: string): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
  );
  if (title) parts.push(`<title>${esc(title)}</title>`);
  if (scene.paper) {
    const g = scene.paper.pitch;
    parts.push(
      `<defs><pattern id="paper" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path d="M${g} 0H0V${g}" fill="none" stroke="${scene.paper.line}" stroke-width="1"/></pattern></defs>`,
    );
  }
  parts.push(`<rect width="100%" height="100%" fill="${scene.background}"/>`);
  if (scene.paper) parts.push(`<rect width="100%" height="100%" fill="url(#paper)"/>`);
  for (const e of scene.edges)
    parts.push(
      `<g data-edge="${esc(e.id)}">${[...e.lines, ...e.heads, ...e.labels].map((p) => el(p, scene)).join('')}</g>`,
    );
  for (const n of scene.nodes)
    parts.push(`<g data-node="${esc(n.id)}">${[...n.body, ...n.text].map((p) => el(p, scene)).join('')}</g>`);
  parts.push('</svg>');
  return parts.join('');
}
