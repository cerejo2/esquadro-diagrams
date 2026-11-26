// Provisional home page, online while the analyzers and the editor are built.
const text = {
  pt: {
    lead: 'Do código ao diagrama, no teu browser. Java, C, Bash e SQL, em notações de aula, editáveis à mão.',
    status: 'Em construção.',
    spike: 'Ver o teste do parser',
  },
  en: {
    lead: 'From code to diagram, in your browser. Java, C, Bash and SQL, in textbook notations, editable by hand.',
    status: 'Under construction.',
    spike: 'See the parser test',
  },
};

export function Placeholder() {
  const t = navigator.language.toLowerCase().startsWith('pt') ? text.pt : text.en;
  return (
    <main className="page">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <path d="M6 50 L50 50 L6 6 Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        <path d="M16 42 L34 42 L16 24 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <h1>Esquadro</h1>
      <p>{t.lead}</p>
      <p>
        {t.status} <a href="./spike.html">{t.spike}</a>
      </p>
    </main>
  );
}
