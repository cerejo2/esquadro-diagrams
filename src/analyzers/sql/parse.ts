// Tolerant recursive-descent DDL parser (PROMPT.md §7.4). It understands
// CREATE TABLE, ALTER TABLE ... ADD and CREATE VIEW; everything else is skipped
// up to the next `;` or `GO` (or, in scripts without semicolons, up to the next
// line that starts a statement). Unknown statements leave an `info` diagnostic;
// procedures, functions and triggers leave one with their name.
import type { Diagnostic, SourceFile, SourceRef } from '../../model/types';
import { diagnostic } from '../shared/evidence';
import { byPath } from '../shared/ids';
import { type ForeignKey, type Table, type View, findColumn, findNamed, sameObject } from './schema';
import { type Token, tokenize } from './tokenize';

export interface ParsedSchema {
  tables: Table[];
  views: View[];
  diagnostics: Diagnostic[];
}

/** Words that start a statement; used to find where a statement ends when `;` is missing (T-SQL). */
const STMT_START = new Set([
  'CREATE', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'SELECT', 'USE', 'SET', 'PRINT', 'EXEC', 'EXECUTE',
  'IF', 'ELSE', 'WHILE', 'BEGIN', 'END', 'DECLARE', 'GRANT', 'REVOKE', 'DENY', 'TRUNCATE', 'COMMIT', 'ROLLBACK', 'PRAGMA',
  'RAISERROR', 'THROW', 'RETURN', 'MERGE',
]); // prettier-ignore

/** Statements that never matter for a schema diagram: skipped silently. */
const IGNORED = new Set([
  'USE', 'SET', 'PRINT', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'SELECT', 'EXEC', 'EXECUTE', 'DECLARE', 'GRANT',
  'REVOKE', 'DENY', 'TRUNCATE', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'PRAGMA', 'COMMENT', 'START',
  'LOCK', 'UNLOCK', 'VACUUM', 'ANALYZE', 'ANALYSE', 'REINDEX', 'ATTACH', 'DETACH', 'MERGE', 'WITH', 'CALL', 'DO',
  'REPLACE', 'COPY', 'RAISERROR', 'THROW', 'RETURN', 'WAITFOR', 'BACKUP', 'RESTORE', 'DBCC', 'CHECKPOINT',
  'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'OPEN', 'CLOSE', 'FETCH', 'DEALLOCATE', 'GOTO', 'BREAK', 'CONTINUE',
  'REFRESH', 'RESET', 'LISTEN', 'NOTIFY', 'UNLISTEN', 'DISCARD', 'SECURITY', 'CLUSTER', 'LOAD', 'OPTIMIZE',
  'FLUSH', 'KILL', 'PREPARE', 'ABORT', 'RENAME', 'REFERENCING', 'BULK', 'READTEXT', 'WRITETEXT', 'UPDATETEXT',
]); // prettier-ignore

/** Objects a CREATE can make. */
const OBJECTS = new Set([
  'TABLE', 'VIEW', 'PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'EVENT', 'INDEX', 'SCHEMA', 'DATABASE',
  'SEQUENCE', 'TYPE', 'DOMAIN', 'EXTENSION', 'ROLE', 'USER', 'LOGIN', 'RULE', 'POLICY', 'AGGREGATE', 'SYNONYM',
  'DEFAULT', 'STATISTICS', 'OPERATOR', 'CAST', 'COLLATION', 'PUBLICATION', 'SUBSCRIPTION', 'SERVER', 'TABLESPACE',
  'LANGUAGE', 'MATERIALIZED', 'ASSEMBLY', 'CERTIFICATE', 'CREDENTIAL', 'QUEUE', 'SERVICE', 'CONTRACT',
]); // prettier-ignore
const ROUTINES = new Set(['PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'EVENT']);

/** Words that end a column's type and start its constraints. */
const COL_STOP = new Set([
  'NOT', 'NULL', 'PRIMARY', 'UNIQUE', 'DEFAULT', 'CHECK', 'REFERENCES', 'CONSTRAINT', 'IDENTITY',
  'AUTO_INCREMENT', 'AUTOINCREMENT', 'GENERATED', 'COLLATE', 'COMMENT', 'ON', 'CHARSET', 'AS', 'ROWGUIDCOL',
  'SPARSE', 'FILESTREAM', 'MASKED', 'ENCRYPTED', 'KEY',
]); // prettier-ignore

/** Words that start a table-level constraint inside CREATE TABLE ( ... ). */
const TABLE_CONSTRAINT = new Set(['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'EXCLUDE', 'PERIOD', 'LIKE']);
const INDEX_WORDS = new Set(['KEY', 'INDEX', 'FULLTEXT', 'SPATIAL']);

/** Words after a table name in FROM that are not an alias. */
const NOT_ALIAS = new Set([
  'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'GROUP', 'ORDER', 'UNION', 'HAVING',
  'LIMIT', 'NATURAL', 'USING', 'WITH', 'EXCEPT', 'INTERSECT', 'WINDOW', 'OFFSET', 'FETCH', 'FOR', 'AS', 'GO',
]); // prettier-ignore
/** Line-start words that end a view body written without `;`. */
const VIEW_STOP = new Set(['CREATE', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'GRANT', 'EXEC', 'EXECUTE', 'PRINT', 'USE', 'SET', 'IF', 'DECLARE', 'COMMIT']); // prettier-ignore

/** ALTER TABLE actions; after an ADD, a comma-separated item that starts with none of them is one more ADD (T-SQL `ADD a INT, b INT`). */
const ALTER_VERBS = new Set([
  'ADD', 'DROP', 'ALTER', 'MODIFY', 'CHANGE', 'RENAME', 'ENABLE', 'DISABLE', 'SET', 'RESET', 'OWNER', 'ATTACH',
  'DETACH', 'VALIDATE', 'INHERIT', 'NO', 'CLUSTER', 'REPLICA', 'FORCE', 'OF', 'NOT', 'ALGORITHM', 'LOCK', 'ORDER',
  'CONVERT', 'DEFAULT', 'CHARACTER', 'COLLATE', 'ENGINE', 'AUTO_INCREMENT', 'COMMENT', 'SWITCH', 'REBUILD',
]); // prettier-ignore
/** Keywords that cannot be an unquoted table or view name: `CREATE VIEW AS SELECT ...` has no name. */
const NOT_A_NAME = new Set(['AS', 'TABLE', 'VIEW', 'SELECT', 'FROM', 'WHERE', 'CREATE', 'ALTER', 'DROP', 'WITH', 'ON']);

const SERIAL = new Set(['serial', 'bigserial', 'smallserial', 'serial2', 'serial4', 'serial8']);

const isEnd = (t: Token | undefined) => !t || t.kind === 'term' || t.kind === 'go';
const isPunct = (t: Token | undefined, p: string) => !!t && t.kind === 'punct' && t.text === p;
const isWordTok = (t: Token | undefined, ...words: string[]) => !!t && t.kind === 'word' && words.includes(t.upper);
const isIdent = (t: Token | undefined) => !!t && (t.kind === 'word' || t.kind === 'qident');

class Cursor {
  readonly toks: readonly Token[];
  i: number;
  readonly end: number;
  constructor(toks: readonly Token[], i = 0, end = toks.length) {
    this.toks = toks;
    this.i = i;
    this.end = end;
  }
  peek(k = 0): Token | undefined {
    const j = this.i + k;
    return j < this.end ? this.toks[j] : undefined;
  }
  next(): Token | undefined {
    const t = this.peek();
    if (t) this.i++;
    return t;
  }
  atEnd(): boolean {
    return this.i >= this.end;
  }
  isWord(...words: string[]): boolean {
    return isWordTok(this.peek(), ...words);
  }
  accept(...words: string[]): boolean {
    if (!this.isWord(...words)) return false;
    this.i++;
    return true;
  }
  /** Accepts a sequence of words (IF NOT EXISTS) only when all of them are there. */
  acceptSeq(...words: string[]): boolean {
    for (let k = 0; k < words.length; k++) if (!isWordTok(this.peek(k), words[k]!)) return false;
    this.i += words.length;
    return true;
  }
  ident(): string | undefined {
    const t = this.peek();
    if (!isIdent(t)) return undefined;
    this.i++;
    return t!.text;
  }
  /** `a`, `s.a`, `db.s.a`, `db..a`: returns the last part and the one before it. */
  qualifiedName(): { name: string; schema?: string } | undefined {
    const first = this.ident();
    if (first === undefined) return undefined;
    const parts = [first];
    while (isPunct(this.peek(), '.')) {
      this.i++;
      if (isPunct(this.peek(), '.')) continue;
      const p = this.ident();
      if (p === undefined) break;
      parts.push(p);
    }
    const name = parts[parts.length - 1]!;
    return parts.length > 1 ? { name, schema: parts[parts.length - 2] } : { name };
  }
  /** At `(`: consumes up to the matching `)`, stopping early at a statement end. Returns the tokens. */
  group(): Token[] {
    const out: Token[] = [];
    let depth = 0;
    while (!this.atEnd()) {
      const t = this.peek()!;
      if (isEnd(t)) break;
      this.i++;
      out.push(t);
      if (isPunct(t, '(')) depth++;
      else if (isPunct(t, ')') && --depth <= 0) break;
    }
    return out;
  }
  /** At `(`: the first identifier of each comma-separated item (`(a ASC, b(10))` gives [a, b]). */
  identList(): string[] {
    if (!isPunct(this.peek(), '(')) return [];
    this.i++;
    const names: string[] = [];
    let depth = 0;
    let expect = true;
    while (!this.atEnd()) {
      const t = this.next()!;
      if (isEnd(t)) {
        this.i--;
        break;
      }
      if (isPunct(t, '(')) depth++;
      else if (isPunct(t, ')')) {
        if (depth === 0) break;
        depth--;
      } else if (isPunct(t, ',') && depth === 0) expect = true;
      else if (expect && depth === 0 && isIdent(t)) {
        names.push(t.text);
        expect = false;
      }
    }
    return names;
  }
  skipTo(p: string): void {
    while (!this.atEnd() && !isPunct(this.peek(), p)) this.i++;
  }
}

/** Joins type tokens for display: `DECIMAL(10,2)`, `INT UNSIGNED`, `integer[]`. */
function formatType(toks: readonly Token[]): string | undefined {
  let s = '';
  let prev: Token | undefined;
  for (const t of toks) {
    const tight = t.kind === 'punct' && '(),[]'.includes(t.text);
    const afterOpen = prev && prev.kind === 'punct' && '(,['.includes(prev.text);
    if (s && !tight && !afterOpen) s += ' ';
    s += t.text;
    prev = t;
  }
  return s || undefined;
}

function emptyTable(name: string, schema: string | undefined, ref: SourceRef): Table {
  const t: Table = { name, columns: [], pk: [], uniques: [], fks: [], ref };
  if (schema) t.schema = schema;
  return t;
}

interface PendingAlter {
  delta: Table;
  ref: SourceRef;
}

class FileParser {
  private readonly c: Cursor;
  private readonly file: string;
  private readonly batchMode: boolean;
  private readonly out: SchemaBuilder;

  constructor(file: SourceFile, out: SchemaBuilder) {
    const toks = tokenize(file.content);
    this.c = new Cursor(toks);
    this.file = file.path;
    this.batchMode = toks.some((t) => t.kind === 'go');
    this.out = out;
  }

  private ref(t: Token | undefined, endLine?: number): SourceRef {
    const line = t?.line ?? 1;
    return endLine && endLine > line ? { file: this.file, line, endLine } : { file: this.file, line };
  }

  private info(message: string, t: Token | undefined) {
    this.out.diagnostics.push(diagnostic('info', message, this.ref(t)));
  }
  private warn(message: string, t: Token | undefined) {
    this.out.diagnostics.push(diagnostic('warn', message, this.ref(t)));
  }

  run(): void {
    const c = this.c;
    while (!c.atEnd()) {
      const t = c.peek()!;
      if (isEnd(t)) {
        c.next();
        continue;
      }
      const before = c.i;
      this.statement();
      if (c.i === before) c.next();
    }
  }

  /** Skips the rest of a statement: to `;`/GO, or to the next line that starts a statement. */
  private skipRest(): void {
    const c = this.c;
    let depth = 0;
    while (!c.atEnd()) {
      const t = c.peek()!;
      if (isEnd(t)) break;
      if (depth === 0 && t.lineStart && t.kind === 'word' && STMT_START.has(t.upper)) break;
      if (isPunct(t, '(')) depth++;
      else if (isPunct(t, ')')) depth = Math.max(0, depth - 1);
      c.next();
    }
    if (c.peek()?.kind === 'term') c.next();
  }

  private skipStatement(): void {
    this.c.next();
    this.skipRest();
  }

  private statement(): void {
    const c = this.c;
    const t = c.peek()!;
    if (t.kind !== 'word') {
      this.info(`skipped a statement that starts with "${t.text.slice(0, 20)}"`, t);
      this.skipStatement();
      return;
    }
    switch (t.upper) {
      case 'CREATE':
        return this.create();
      case 'ALTER':
        return this.alter();
      case 'IF':
      case 'WHILE':
        return this.condition();
      case 'BEGIN':
        return this.begin();
      case 'END':
        c.next();
        c.accept('TRY', 'CATCH', 'TRANSACTION', 'TRAN');
        return;
      case 'ELSE':
        c.next();
        return;
      default:
        if (!IGNORED.has(t.upper)) this.info(`skipped an unrecognised statement "${t.text}"`, t);
        this.skipStatement();
    }
  }

  /** `IF cond stmt` / `WHILE cond stmt`: skips the condition and lets the main loop read the body. */
  private condition(): void {
    const c = this.c;
    c.next();
    while (!c.atEnd()) {
      const t = c.peek()!;
      if (isEnd(t)) return;
      if (isPunct(t, '(')) c.group();
      else if (t.kind === 'word' && STMT_START.has(t.upper)) return;
      else c.next();
    }
  }

  private begin(): void {
    const c = this.c;
    c.next();
    if (c.isWord('TRAN', 'TRANSACTION', 'WORK', 'DISTRIBUTED', 'IMMEDIATE', 'EXCLUSIVE', 'DEFERRED')) this.skipRest();
    else if (c.peek()?.kind === 'term') c.next();
    else c.accept('TRY', 'CATCH');
  }

  private create(): void {
    const c = this.c;
    const start = c.next()!;
    let temp = false;
    let k = 0;
    for (; k < 16; k++) {
      const t = c.peek(k);
      if (isEnd(t) || isPunct(t, '(')) break;
      if (isWordTok(t, 'TEMP', 'TEMPORARY')) temp = true;
      if (t!.kind === 'word' && OBJECTS.has(t!.upper)) break;
    }
    const obj = c.peek(k);
    if (!obj || obj.kind !== 'word' || !OBJECTS.has(obj.upper)) {
      this.info('skipped an unrecognised CREATE statement', start);
      this.skipRest();
      return;
    }
    c.i += k + 1;
    if (obj.upper === 'TABLE') return this.createTable(start, temp);
    if (obj.upper === 'VIEW') return this.createView(start);
    if (obj.upper === 'MATERIALIZED' && c.accept('VIEW')) return this.createView(start);
    if (ROUTINES.has(obj.upper)) return this.skipRoutine(obj, start);
    this.skipRest();
  }

  private createTable(start: Token, temp: boolean): void {
    const c = this.c;
    c.acceptSeq('IF', 'NOT', 'EXISTS');
    const q = this.objectName();
    if (!q) {
      this.warn('CREATE TABLE without a table name; skipped', start);
      this.skipRest();
      return;
    }
    if (temp || q.name.startsWith('#')) {
      this.info(`skipped temporary table ${q.name}`, start);
      this.skipRest();
      return;
    }
    if (!isPunct(c.peek(), '(')) {
      this.info(`CREATE TABLE ${q.name} has no column list (AS SELECT, LIKE...); skipped`, start);
      this.skipRest();
      return;
    }
    c.next();
    const elements: Token[][] = [];
    let cur: Token[] = [];
    let depth = 0;
    let closed: Token | undefined;
    while (!c.atEnd()) {
      const t = c.peek()!;
      if (isEnd(t)) break;
      c.next();
      if (isPunct(t, '(')) depth++;
      else if (isPunct(t, ')')) {
        if (depth === 0) {
          closed = t;
          break;
        }
        depth--;
      } else if (isPunct(t, ',') && depth === 0) {
        elements.push(cur);
        cur = [];
        continue;
      }
      cur.push(t);
    }
    elements.push(cur);
    if (!closed) this.warn(`CREATE TABLE ${q.name} is not closed with ")"`, start);
    const table = emptyTable(q.name, q.schema, this.ref(start, (closed ?? c.peek(-1))?.line));
    for (const el of elements) if (el.length) this.element(new Cursor(el), table, 'table');
    // Table options after the closing parenthesis (ENGINE=..., ON [PRIMARY], WITHOUT ROWID).
    this.skipRest();
    this.out.addTable(table, (m) => this.warn(m, start));
  }

  /** The name after CREATE TABLE / VIEW, unless it is missing (a keyword in its place). */
  private objectName(): { name: string; schema?: string } | undefined {
    const t = this.c.peek();
    if (t?.kind === 'word' && NOT_A_NAME.has(t.upper)) return undefined;
    return this.c.qualifiedName();
  }

  /** One item of a CREATE TABLE list, or one ADD of an ALTER TABLE. */
  private element(ec: Cursor, table: Table, where: 'table' | 'alter'): void {
    const t = ec.peek();
    if (!t) return;
    if (t.kind === 'word' && (TABLE_CONSTRAINT.has(t.upper) || (INDEX_WORDS.has(t.upper) && this.isIndexDef(ec))))
      this.tableConstraint(ec, table, where);
    else this.column(ec, table, where);
  }

  /** `KEY idx (a)` / `INDEX (a)` (MySQL index) rather than a column called key or index. */
  private isIndexDef(ec: Cursor): boolean {
    const a = ec.peek(1);
    if (!a || isPunct(a, '(')) return true;
    if (isWordTok(a, 'KEY', 'INDEX')) return true; // FULLTEXT KEY, SPATIAL INDEX
    if (isWordTok(ec.peek(2), 'USING')) return isIdent(a);
    // `KEY idx (a, b)` lists columns; `key VARCHAR(40)` is a column whose type has arguments.
    return isIdent(a) && isPunct(ec.peek(2), '(') && isIdent(ec.peek(3));
  }

  private tableConstraint(ec: Cursor, table: Table, where: 'table' | 'alter'): void {
    let name: string | undefined;
    if (ec.accept('CONSTRAINT')) name = ec.ident();
    const t = ec.next();
    if (!t || t.kind !== 'word') return;
    switch (t.upper) {
      case 'PRIMARY': {
        ec.skipTo('(');
        const cols = ec.identList();
        if (cols.length) {
          table.pk = cols;
          table.pkRef = this.ref(t);
        }
        return;
      }
      case 'UNIQUE': {
        ec.skipTo('(');
        const cols = ec.identList();
        if (cols.length) table.uniques.push(cols);
        return;
      }
      case 'FOREIGN': {
        ec.skipTo('(');
        const cols = ec.identList();
        if (!ec.accept('REFERENCES')) return;
        const r = this.references(ec);
        if (!r || !cols.length) return;
        const fk: ForeignKey = { columns: cols, ...r, origin: where === 'table' ? 'table' : 'alter', ref: this.ref(t) };
        if (name) fk.name = name;
        table.fks.push(fk);
        return;
      }
      default:
        return; // CHECK, EXCLUDE, DEFAULT ... FOR, indexes
    }
  }

  /** After REFERENCES: `t [(cols)] [ON DELETE ...] [ON UPDATE ...] [MATCH ...]`. */
  private references(ec: Cursor): { refTable: string; refSchema?: string; refColumns: string[] } | undefined {
    const q = ec.qualifiedName();
    if (!q) return undefined;
    const refColumns = ec.identList();
    for (;;) {
      if (ec.isWord('ON') && isWordTok(ec.peek(1), 'DELETE', 'UPDATE')) {
        ec.i += 2;
        if (ec.accept('SET')) ec.next();
        else if (ec.accept('NO')) ec.accept('ACTION');
        else ec.next();
      } else if (ec.accept('MATCH')) ec.next();
      else break;
    }
    return q.schema ? { refTable: q.name, refSchema: q.schema, refColumns } : { refTable: q.name, refColumns };
  }

  private column(ec: Cursor, table: Table, where: 'table' | 'alter'): void {
    const nameTok = ec.next()!;
    if (!isIdent(nameTok) && nameTok.kind !== 'string') return;
    const name = nameTok.kind === 'string' ? nameTok.text.slice(1, -1) : nameTok.text;
    const typeToks: Token[] = [];
    while (!ec.atEnd()) {
      const t = ec.peek()!;
      if (t.kind === 'word' && COL_STOP.has(t.upper)) break;
      if (isWordTok(t, 'CHARACTER') && isWordTok(ec.peek(1), 'SET')) break;
      if (isPunct(t, '(')) typeToks.push(...ec.group());
      else typeToks.push(ec.next()!);
    }
    const type = formatType(typeToks);
    const col: Table['columns'][number] = {
      name,
      notNull: false,
      identity: !!type && SERIAL.has(type.toLowerCase()),
      ref: this.ref(nameTok),
    };
    if (type) col.type = type;

    let constraintName: string | undefined;
    while (!ec.atEnd()) {
      const t = ec.next()!;
      if (isPunct(t, '(')) {
        ec.i--;
        ec.group();
        continue;
      }
      if (t.kind !== 'word') continue;
      switch (t.upper) {
        case 'CONSTRAINT':
          constraintName = ec.ident();
          continue;
        case 'NOT':
          if (ec.accept('NULL')) col.notNull = true;
          break;
        case 'NULL':
          break;
        case 'PRIMARY':
          ec.accept('KEY');
          table.pk = [name];
          table.pkRef = this.ref(t);
          break;
        case 'KEY': // MySQL: `id INT KEY`
          if (!table.pk.length) {
            table.pk = [name];
            table.pkRef = this.ref(t);
          }
          break;
        case 'UNIQUE':
          ec.accept('KEY');
          table.uniques.push([name]);
          break;
        case 'DEFAULT':
          this.skipDefault(ec);
          break;
        case 'CHECK':
          if (isPunct(ec.peek(), '(')) ec.group();
          break;
        case 'REFERENCES': {
          const r = this.references(ec);
          if (r) {
            const fk: ForeignKey = {
              columns: [name],
              ...r,
              origin: where === 'table' ? 'column' : 'alter',
              ref: this.ref(t),
            };
            if (constraintName) fk.name = constraintName;
            table.fks.push(fk);
          }
          break;
        }
        case 'IDENTITY':
        case 'AUTO_INCREMENT':
        case 'AUTOINCREMENT':
          col.identity = true;
          if (isPunct(ec.peek(), '(')) ec.group();
          break;
        case 'GENERATED':
          ec.accept('ALWAYS');
          ec.acceptSeq('BY', 'DEFAULT');
          ec.accept('AS');
          if (ec.accept('IDENTITY')) col.identity = true;
          if (isPunct(ec.peek(), '(')) ec.group();
          break;
        case 'AS':
          if (isPunct(ec.peek(), '(')) ec.group();
          break;
        case 'COLLATE':
        case 'CHARSET':
        case 'COMMENT':
          ec.next();
          break;
        case 'CHARACTER':
          if (ec.accept('SET')) ec.next();
          break;
        case 'ON': // MySQL ON UPDATE CURRENT_TIMESTAMP, SQLite ON CONFLICT REPLACE
          ec.next();
          ec.next();
          if (isPunct(ec.peek(), '(')) ec.group();
          break;
        default:
          break;
      }
      constraintName = undefined;
    }
    if (findColumn(table, name)) {
      this.warn(`column ${table.name}.${name} is declared twice`, nameTok);
      return;
    }
    table.columns.push(col);
  }

  /** DEFAULT value: a literal, a parenthesised expression or a call, with optional `::type` casts. */
  private skipDefault(ec: Cursor): void {
    if (isPunct(ec.peek(), '-') || isPunct(ec.peek(), '+')) ec.next();
    if (isPunct(ec.peek(), '(')) ec.group();
    else {
      ec.next();
      if (isPunct(ec.peek(), '(')) ec.group();
    }
    while (isPunct(ec.peek(), ':') && isPunct(ec.peek(1), ':')) {
      ec.i += 2;
      ec.next();
      if (isPunct(ec.peek(), '(')) ec.group();
    }
  }

  private alter(): void {
    const c = this.c;
    const start = c.next()!;
    if (!c.accept('TABLE')) {
      const obj = c.peek();
      if (obj && obj.kind === 'word' && ROUTINES.has(obj.upper)) {
        c.next();
        return this.skipRoutine(obj, start);
      }
      this.skipRest();
      return;
    }
    c.accept('ONLY');
    c.acceptSeq('IF', 'EXISTS');
    const q = c.qualifiedName();
    if (!q) {
      this.skipRest();
      return;
    }
    // The actions, split at top-level commas.
    const actions: Token[][] = [];
    let cur: Token[] = [];
    let depth = 0;
    let last = start;
    while (!c.atEnd()) {
      const t = c.peek()!;
      if (isEnd(t)) break;
      if (depth === 0 && t.lineStart && t.kind === 'word' && STMT_START.has(t.upper)) break;
      c.next();
      last = t;
      if (isPunct(t, '(')) depth++;
      else if (isPunct(t, ')')) depth = Math.max(0, depth - 1);
      else if (isPunct(t, ',') && depth === 0) {
        actions.push(cur);
        cur = [];
        continue;
      }
      cur.push(t);
    }
    actions.push(cur);
    if (c.peek()?.kind === 'term') c.next();

    const delta = emptyTable(q.name, q.schema, this.ref(start, last.line));
    let lastVerb = '';
    for (const a of actions) {
      const ac = new Cursor(a);
      if (ac.accept('WITH')) ac.accept('CHECK', 'NOCHECK');
      if (ac.accept('ADD')) {
        lastVerb = 'ADD';
        ac.accept('COLUMN');
        ac.acceptSeq('IF', 'NOT', 'EXISTS');
        this.element(ac, delta, 'alter');
      } else if (lastVerb === 'ADD' && isIdent(ac.peek()) && !isWordTok(ac.peek(), ...ALTER_VERBS)) {
        this.element(ac, delta, 'alter');
      } else {
        lastVerb = ac.peek()?.upper ?? '';
      }
    }
    if (delta.columns.length || delta.pk.length || delta.uniques.length || delta.fks.length)
      this.out.alter({ delta, ref: this.ref(start) });
  }

  private createView(start: Token): void {
    const c = this.c;
    c.acceptSeq('IF', 'NOT', 'EXISTS');
    const q = this.objectName();
    if (!q) {
      this.warn('CREATE VIEW without a view name; skipped', start);
      this.skipRest();
      return;
    }
    if (isPunct(c.peek(), '(')) c.group();
    while (!isEnd(c.peek()) && !c.isWord('AS')) c.next();
    c.accept('AS');
    const deps: View['deps'] = [];
    let last = start;
    while (!c.atEnd()) {
      const t = c.peek()!;
      if (isEnd(t)) break;
      if (t.lineStart && t.kind === 'word' && VIEW_STOP.has(t.upper)) break;
      c.next();
      last = t;
      if (isWordTok(t, 'FROM', 'JOIN')) this.tableList(deps, t.upper === 'FROM');
    }
    if (c.peek()?.kind === 'term') c.next();
    const view: View = { name: q.name, deps, ref: this.ref(start, last.line) };
    if (q.schema) view.schema = q.schema;
    this.out.addView(view, (m) => this.warn(m, start));
  }

  /** After FROM or JOIN: `t [AS] [alias] [, u ...]`, skipping opening parentheses of nested joins. */
  private tableList(deps: View['deps'], isFrom: boolean): void {
    const c = this.c;
    for (;;) {
      while (isPunct(c.peek(), '(')) c.next();
      if (c.isWord('SELECT', 'WITH', 'VALUES', 'LATERAL')) return;
      const at = c.peek();
      const q = c.qualifiedName();
      if (!q) return;
      if (!isPunct(c.peek(), '('))
        deps.push(
          q.schema ? { name: q.name, schema: q.schema, ref: this.ref(at) } : { name: q.name, ref: this.ref(at) },
        );
      if (c.accept('AS')) c.ident();
      else {
        const a = c.peek();
        if (a && (a.kind === 'qident' || (a.kind === 'word' && !NOT_ALIAS.has(a.upper)))) c.next();
      }
      if (isFrom && isPunct(c.peek(), ',')) {
        c.next();
        continue;
      }
      return;
    }
  }

  /**
   * Procedures, functions and triggers. In a T-SQL script with GO the routine
   * is its whole batch; otherwise it ends at the first `;` outside BEGIN...END
   * (MySQL DELIMITER and PostgreSQL $$ bodies are single tokens already).
   */
  private skipRoutine(kindTok: Token, start: Token): void {
    const c = this.c;
    const q = c.qualifiedName();
    const kind = kindTok.upper === 'PROC' ? 'procedure' : kindTok.upper.toLowerCase();
    this.info(`skipped ${kind}${q ? ` ${q.name}` : ''}`, start);
    if (this.batchMode) {
      while (!c.atEnd() && c.peek()!.kind !== 'go') c.next();
      return;
    }
    let depth = 0;
    while (!c.atEnd()) {
      const t = c.next()!;
      if (t.kind === 'go') {
        c.i--;
        return;
      }
      if (t.kind === 'term') {
        if (depth === 0) return;
        continue;
      }
      if (t.kind !== 'word') continue;
      if (t.upper === 'BEGIN') {
        if (!c.isWord('TRAN', 'TRANSACTION', 'WORK', 'DISTRIBUTED')) depth++;
      } else if (t.upper === 'CASE') depth++;
      else if (t.upper === 'END') {
        if (c.isWord('IF', 'LOOP', 'WHILE', 'REPEAT', 'FOR')) c.next();
        else {
          c.accept('CASE');
          depth = Math.max(0, depth - 1);
        }
      }
    }
  }
}

/** Collects tables, views and ALTERs across files, then applies the ALTERs. */
class SchemaBuilder {
  readonly tables: Table[] = [];
  readonly views: View[] = [];
  readonly diagnostics: Diagnostic[] = [];
  private readonly pending: PendingAlter[] = [];

  /** A second CREATE of the same object replaces the first in place (same schema, or either unqualified). */
  private static put<T extends Table | View>(list: T[], item: T, what: string, warn: (m: string) => void): void {
    const i = list.findIndex((x) => sameObject(x, item));
    if (i < 0) {
      list.push(item);
      return;
    }
    warn(`${what} ${item.name} is created more than once; the last definition wins`);
    list[i] = item;
  }

  addTable(t: Table, warn: (m: string) => void): void {
    SchemaBuilder.put(this.tables, t, 'table', warn);
  }

  addView(v: View, warn: (m: string) => void): void {
    SchemaBuilder.put(this.views, v, 'view', warn);
  }

  alter(p: PendingAlter): void {
    const target = findNamed(this.tables, p.delta);
    if (target) apply(target, p.delta);
    else this.pending.push(p);
  }

  finish(): ParsedSchema {
    for (const p of this.pending) {
      const target = findNamed(this.tables, p.delta);
      if (target) apply(target, p.delta);
      else this.diagnostics.push(diagnostic('warn', `ALTER TABLE ${p.delta.name}: no CREATE TABLE for it`, p.ref));
    }
    return { tables: this.tables, views: this.views, diagnostics: this.diagnostics };
  }
}

function apply(target: Table, delta: Table): void {
  for (const col of delta.columns) if (!findColumn(target, col.name)) target.columns.push(col);
  if (delta.pk.length) {
    target.pk = delta.pk;
    if (delta.pkRef) target.pkRef = delta.pkRef;
  }
  target.uniques.push(...delta.uniques);
  target.fks.push(...delta.fks);
}

/** Parses every file (sorted by path, so the result never depends on input order). */
export function parseSql(files: readonly SourceFile[]): ParsedSchema {
  const out = new SchemaBuilder();
  for (const f of byPath(files)) new FileParser(f, out).run();
  return out.finish();
}
