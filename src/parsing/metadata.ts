import {assert} from '../lib/base';
import {Template} from '../lib/template';
import {Grammar, Syntax} from '../parsing/grammar';
import {Parser} from '../parsing/parser';

// The output of the metadata grammar is a list of ItemNode values.

type ItemNode =
  {type: 'score', score: ScoreNode[]} |
  {type: 'syntax', syntaxes: SyntaxNode[]} |
  {type: 'template', template: string};

type ScoreNode = number | {i: number, score: number};

type SyntaxNode = (number | string)[];

// This module will read metadata expressions and return parsed metadata.

interface Metadata {
  scores: number[],
  suffix: string,
};

type Modifier = '?' | '*' | '+' | null;

interface Settings {templated?: boolean};

// The public interface of this file follows.

const build_base_case = (
    modifier: Modifier, score: number, settings: Settings): string => {
  score = modifier === '+' ? score : 0;
  const transform = `builtin_base_cases['${modifier}']`;
  return settings.templated ? `(= ${transform}) (! ${score})` : transform;
}

const build_recursive = (
    modifier: Modifier, score: number, settings: Settings): string => {
  const transform = `builtin_recursives['${modifier}']`;
  return settings.templated ? `(= ${transform}) (! ${score})` : transform;
}

const generate_header = (settings: Settings): string => {
  return settings.templated ? `
const template = require('../lib/template');

const builtin_base_cases = {
  '?': new template.Template('[]', []),
  '*': new template.Template('[]', []),
  '+': new template.Template('[$0]', [false]),
};
const builtin_recursives = {
  '?': new template.Template('$0', [false]),
  '*': new template.Template('[...$0, $1]', [true, false]),
  '+': new template.Template('[...$0, $1]', [false, false]),
};
  ` : `
const builtin_base_cases = {
  '?': (d) => null,
  '*': (d) => d,
  '+': (d) => d,
};
const builtin_recursives = {
  '?': (d) => d[0],
  '*': (d) => d[0].concat([d[1]]),
  '+': (d) => d[0].concat([d[1]]),
};
  `;
}

const parse = (input: string | void, modifiers: Modifier[],
               settings: Settings): Metadata => {
  const result = {scores: Array(modifiers.length).fill(0), suffix: ''};
  if (!input) return result;
  if (!settings.templated) {
    result.suffix = `, transform: ${input}`;
    return result;
  }
  const grammar = Grammar.from_file('../dsl/metadata');
  const items: ItemNode[] = Parser.parse(grammar, input).value!.some;
  for (const item of items) {
    if (item.type === 'score') {
      const score = item.score.map((x) => typeof x === 'number' ? x : 0);
      item.score.forEach((x) => {
        if (typeof x === 'number') return;
        if (!modifiers[x.i]) throw new Error(`Non-modifier scored: ${input}`);
        result.scores[x.i] += x.score;
      });
      result.suffix += `, score: ${score}`;
    } else if (item.type === 'syntax') {
      result.suffix += parse_syntaxes(item.syntaxes, modifiers.length);
    } else if (item.type === 'template') {
      result.suffix += parse_template(item.template, modifiers);
    }
  }
  return result;
}

const parse_syntax = (input: SyntaxNode): Syntax => {
  const syntax: Syntax = {indices: [], tense: {}};
  for (const x of input) {
    if (typeof x === 'number') {
      syntax.indices.push(x);
    } else {
      syntax.tense = <any>(new Template(x).merge([]));
    }
  }
  return syntax;
}

const parse_syntaxes = (input: SyntaxNode[], n: number): string => {
  const marked: boolean[] = Array(n).fill(false);
  const syntaxes = input.map(parse_syntax);
  for (const syntax of syntaxes) {
    for (const i of syntax.indices) {
      if (!(0 <= i && i < n)) throw new Error(`Index out of bounds: $${i}`);
      if (marked[i]) throw new Error(`Index appears multiple times: $${i}`);
      marked[i] = true;
    }
  }
  const unmarked = marked.map((x, i) => x ? -1 : i).filter((x) => x >= 0);
  unmarked.forEach((x) => syntaxes.push({indices: [x], tense: {}}));
  return `, syntaxes: [${syntaxes.map((x) => JSON.stringify(x)).join(', ')}]`;
}

const parse_template = (input: string, modifiers: Modifier[]): string => {
  if (input.startsWith('builtin_')) return `, transform: ${input}`;
  const optional = modifiers.map((x) => x === '?' || x === '*');
  new Template(input, optional); // Check the template's syntax.
  const args = JSON.stringify([input, optional]).slice(1, -1);
  return `, transform: new template.Template(${args})`;
}

const Metadata = {build_base_case, build_recursive, generate_header, parse};

export {Metadata};
