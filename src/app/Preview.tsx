// "Mesa de desenho": the Phase 2 page. It analyses a public example in the
// browser, lays it out, and lets the diagram draw itself on the stage.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../analyzers/shared/tree-sitter-browser';
import { analyzerFor } from '../analyzers';
import { layoutCandidates } from '../layout/candidates';
import type { Layout } from '../layout/types';
import type { DiagramKind, DiagramModel, Lang, SourceFile } from '../model/types';
import { buildScene, prepareLayout, type Prepared } from '../render';
import { defaultTheme, THEMES, type ThemeId } from '../render/themes';
import { Canvas, type Arrival, type Focus } from './Canvas';
import { EXAMPLES, KIND_NAMES, LANG_NAMES, loadExample, type Example } from './examples';

const HINT =
  typeof matchMedia === 'function' && matchMedia('(hover: none)').matches
    ? 'Toca num elemento do diagrama para ver de onde veio.'
    : 'Passa o rato ou usa Tab sobre o diagrama para ver a origem de cada elemento.';

const LANGS: Lang[] = ['java', 'c', 'bash', 'sql'];
const THEME_IDS: ThemeId[] = ['vp', 'ssms', 'drawio-dark', 'caderno'];

type Drawn = { key: string; model: DiagramModel; prepared: Prepared; layouts: Layout[] };

const files = new Map<string, Promise<SourceFile[]>>();
const models = new Map<string, Promise<DiagramModel>>();

function analyse(ex: Example, kind: DiagramKind): Promise<DiagramModel> {
  const key = `${ex.lang}/${ex.name}|${kind}`;
  let m = models.get(key);
  if (!m) {
    const id = `${ex.lang}/${ex.name}`;
    let f = files.get(id);
    if (!f) files.set(id, (f = loadExample(ex)));
    m = f.then((fs) => analyzerFor(ex.lang).analyze(fs, kind, { locale: 'pt' }));
    models.set(key, m);
  }
  return m;
}

/** Deep link: #/java/festival/class[/caderno]. Anything unknown falls back to the first example. */
function fromHash(): { example: Example; kind: DiagramKind; theme: ThemeId | null } {
  const [lang, name, k, t] = location.hash.replace(/^#\/?/, '').split('/');
  const example = EXAMPLES.find((e) => e.lang === lang && e.name === name) ?? EXAMPLES[0]!;
  const kinds = analyzerFor(example.lang).kinds;
  const kind = kinds.find((x) => x === `${example.lang}.${k}`) ?? kinds[0]!;
  const theme = THEME_IDS.find((x) => x === t) ?? null;
  return { example, kind, theme };
}

export function Preview() {
  const [initial] = useState(fromHash);
  const [example, setExample] = useState<Example>(initial.example);
  const [kind, setKind] = useState<DiagramKind>(initial.kind);
  const [themeChoice, setThemeChoice] = useState<ThemeId | null>(initial.theme);

  useEffect(() => {
    const hash = `#/${example.lang}/${example.name}/${kind.split('.')[1]}${themeChoice ? `/${themeChoice}` : ''}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }, [example, kind, themeChoice]);
  const theme = themeChoice ?? defaultTheme(kind);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [candidate, setCandidate] = useState(0);
  const [arrival, setArrival] = useState<Arrival>({ mode: 'enter', token: 0 });
  const [hover, setHover] = useState<Focus>(null);
  const [pinned, setPinned] = useState<Focus>(null);
  const lastDrawing = useRef('');

  useEffect(() => {
    let live = true;
    const drawing = `${example.lang}/${example.name}|${kind}`;
    analyse(example, kind)
      .then(async (model) => {
        const prepared = prepareLayout(model, theme, 'pt');
        const layouts = model.nodes.length ? await layoutCandidates(prepared.input) : [];
        if (!live) return;
        const fresh = lastDrawing.current !== drawing;
        lastDrawing.current = drawing;
        setDrawn({ key: `${drawing}|${theme}`, model, prepared, layouts });
        setCandidate(0);
        setPinned(null);
        setArrival((a) => ({ mode: fresh ? 'enter' : 'flip', token: a.token + 1 }));
      })
      .catch((e: unknown) => {
        if (live) setFailed({ key: `${drawing}|${theme}`, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [example, kind, theme]);

  // Busy until the drawing for the current choices has arrived (or failed).
  const wanted = `${example.lang}/${example.name}|${kind}|${theme}`;
  const busy = drawn?.key !== wanted && failed?.key !== wanted;
  const error = failed?.key === wanted ? failed.message : null;

  const scene = useMemo(() => {
    const l = drawn?.layouts[candidate];
    return drawn && l ? buildScene(drawn.prepared, l) : null;
  }, [drawn, candidate]);

  const pickLang = (lang: Lang) => {
    if (lang === example.lang) return;
    const ex = EXAMPLES.find((e) => e.lang === lang)!;
    setExample(ex);
    setKind(analyzerFor(lang).kinds[0]!);
  };
  const pickExample = (ex: Example) => {
    if (ex === example) return;
    setExample(ex);
    if (!analyzerFor(ex.lang).kinds.includes(kind)) setKind(analyzerFor(ex.lang).kinds[0]!);
  };
  const step = (d: number) => {
    if (!drawn) return;
    const n = drawn.layouts.length;
    setCandidate((c) => (c + d + n) % n);
    setArrival((a) => ({ mode: 'flip', token: a.token + 1 }));
  };
  const redraw = () => setArrival((a) => ({ mode: 'enter', token: a.token + 1 }));
  const onPin = useCallback((f: Focus) => setPinned((p) => (f && p && p.id === f.id ? null : f)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = hover ?? pinned;
  const evidence = useMemo(() => {
    if (!scene || !shown) return null;
    if (shown.type === 'edge') return scene.edges.find((e) => e.id === shown.id)?.sentence ?? null;
    const n = scene.nodes.find((x) => x.id === shown.id);
    return n ? `${n.aria}${n.source ? ` em ${n.source}` : ''}` : null;
  }, [scene, shown]);

  const layout = drawn?.layouts[candidate];
  const kinds = analyzerFor(example.lang).kinds;
  const title = `${KIND_NAMES[kind]} de ${example.name} (${LANG_NAMES[example.lang]})`;

  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="./" aria-label="Esquadro, início">
          <Mark />
          <span>Esquadro</span>
        </a>
        <UiThemeToggle />
      </header>

      <div className="desk">
        <div className="intro">
          <p className="eyebrow">FASE 2 · MOTOR DE DESENHO</p>
          <h1>
            O código entra.
            <br />O diagrama sai desenhado.
          </h1>
          <p className="sub">
            Exemplos públicos analisados e dispostos aqui mesmo, no browser. Cada ligação mostra a linha de código de
            onde veio.
          </p>
        </div>

        <aside className="controls" aria-label="Escolhas do diagrama">
          <fieldset className="group">
            <legend>Exemplo</legend>
            <div className="chips" role="radiogroup" aria-label="Linguagem">
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={l === example.lang}
                  className="chip"
                  onClick={() => pickLang(l)}
                >
                  {LANG_NAMES[l]}
                </button>
              ))}
            </div>
            <div className="fixtures" role="radiogroup" aria-label="Exemplo">
              {EXAMPLES.filter((e) => e.lang === example.lang).map((e) => (
                <button
                  key={e.name}
                  type="button"
                  role="radio"
                  aria-checked={e === example}
                  className="fixture"
                  onClick={() => pickExample(e)}
                >
                  {e.name}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>Diagrama</legend>
            <div className="chips wrap" role="radiogroup" aria-label="Diagrama">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={k === kind}
                  className="chip"
                  onClick={() => setKind(k)}
                >
                  {KIND_NAMES[k]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>Tema</legend>
            <div className="segmented" role="radiogroup" aria-label="Tema do diagrama">
              {THEME_IDS.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={t === theme} onClick={() => setThemeChoice(t)}>
                  {THEMES[t].name.pt}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>Disposição</legend>
            <div className="candidates">
              <button
                type="button"
                className="icon"
                aria-label="Disposição anterior"
                onClick={() => step(-1)}
                disabled={!drawn || drawn.layouts.length < 2}
              >
                <Chevron dir="left" />
              </button>
              <span className="count" aria-live="polite">
                {drawn?.layouts.length ? `Candidato ${candidate + 1} de ${drawn.layouts.length}` : 'Sem candidatos'}
              </span>
              <button
                type="button"
                className="icon"
                aria-label="Disposição seguinte"
                onClick={() => step(1)}
                disabled={!drawn || drawn.layouts.length < 2}
              >
                <Chevron dir="right" />
              </button>
            </div>
            {layout?.score && (
              <p className="score">
                pontuação {Math.round(layout.score.total)} · {layout.score.crossings} cruzamentos
              </p>
            )}
          </fieldset>
        </aside>

        <main className="stage" aria-busy={busy}>
          <div className={`card${busy ? ' busy' : ''}`} style={scene ? { background: scene.background } : undefined}>
            {error ? (
              <p className="empty">Não foi possível desenhar este exemplo: {error}</p>
            ) : scene ? (
              <Canvas
                key={drawn?.key.split('|').slice(0, 2).join('|')}
                scene={scene}
                arrival={arrival}
                focus={shown}
                title={title}
                onFocus={setHover}
                onPin={onPin}
              />
            ) : drawn && !drawn.model.nodes.length ? (
              <p className="empty">Este exemplo não tem nada para mostrar neste diagrama.</p>
            ) : (
              <p className="empty">A analisar e a dispor…</p>
            )}
          </div>
          <div className="foot">
            <p className={`evidence${evidence ? ' on' : ''}`} aria-live="polite">
              {evidence ?? HINT}
            </p>
            <button type="button" className="ghost" onClick={redraw} disabled={!scene}>
              <Replay />
              Redesenhar
            </button>
          </div>
          {scene && drawn && <AsText scene={scene} model={drawn.model} title={title} />}
        </main>
      </div>
    </div>
  );
}

function AsText({
  scene,
  model,
  title,
}: {
  scene: NonNullable<ReturnType<typeof buildScene>>;
  model: DiagramModel;
  title: string;
}) {
  return (
    <details className="as-text">
      <summary>Ver como texto</summary>
      <p>
        {title}: {model.nodes.length} elementos e {model.edges.length} ligações.
      </p>
      <table>
        <caption>Elementos</caption>
        <thead>
          <tr>
            <th scope="col">Elemento</th>
            <th scope="col">Origem</th>
          </tr>
        </thead>
        <tbody>
          {scene.nodes.map((n) => (
            <tr key={n.id}>
              <td>{n.aria}</td>
              <td className="mono">{n.source ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {scene.edges.length > 0 && (
        <table>
          <caption>Ligações</caption>
          <tbody>
            {scene.edges.map((e) => (
              <tr key={e.id}>
                <td>{e.sentence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

function UiThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try {
      localStorage.setItem('esquadro.ui-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  };
  return (
    <button
      type="button"
      className="icon"
      aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      onClick={flip}
    >
      {dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 21H21L3 3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7.5 17.5H13L7.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3 8h2M3 12h1.5M3 16h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Replay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12a8 8 0 1 0 2.4-5.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M4 4v4h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
