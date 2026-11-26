import { LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from 'web-tree-sitter';
import { describe, expect, it } from 'vitest';
import { samples } from '../../spike/samples';
import { outline } from '../../spike/outline';
import { type Grammar, getLanguage, getParser } from './tree-sitter';

const grammars: Grammar[] = ['java', 'c', 'bash'];

describe('tree-sitter spike (Node)', () => {
  it.each(grammars)('%s grammar ABI is supported by web-tree-sitter', async (g) => {
    const lang = await getLanguage(g);
    expect(lang.abiVersion).toBeGreaterThanOrEqual(MIN_COMPATIBLE_VERSION);
    expect(lang.abiVersion).toBeLessThanOrEqual(LANGUAGE_VERSION);
  });

  it.each(grammars)('%s sample parses without errors', async (g) => {
    const parser = await getParser(g);
    const tree = parser.parse(samples[g]);
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.hasError).toBe(false);
    expect(outline(tree!.rootNode).length).toBeGreaterThan(0);
    tree!.delete();
    parser.delete();
  });

  it('finds the Java class, its superclass and interface', async () => {
    const parser = await getParser('java');
    const root = parser.parse(samples.java)!.rootNode;
    const cls = root.descendantsOfType('class_declaration')[0]!;
    expect(cls.childForFieldName('name')?.text).toBe('Greenhouse');
    expect(cls.childForFieldName('superclass')?.text).toContain('Building');
    expect(cls.childForFieldName('interfaces')?.text).toContain('Heated');
  });

  it('finds the C typedef struct and the function', async () => {
    const parser = await getParser('c');
    const root = parser.parse(samples.c)!.rootNode;
    expect(root.descendantsOfType('type_definition')[0]?.text).toContain('Ring;');
    const fn = root.descendantsOfType('function_definition')[0]!;
    expect(fn.text).toContain('ring_create');
  });

  it('finds the Bash function and the call to it', async () => {
    const parser = await getParser('bash');
    const root = parser.parse(samples.bash)!.rootNode;
    const fn = root.descendantsOfType('function_definition')[0]!;
    expect(fn.childForFieldName('name')?.text).toBe('backup');
    const commands = root.descendantsOfType('command_name').map((n) => n?.text);
    expect(commands).toContain('backup');
  });

  it('shares one language load between concurrent callers', async () => {
    const [a, b] = await Promise.all([getLanguage('java'), getLanguage('java')]);
    expect(a).toBe(b);
  });
});
