import {Template} from '../lib/template';
import {Grammar} from '../parsing/grammar';
import {Parser} from '../parsing/parser';

// The output of the metadata grammar is a list of ItemNode values.

type ItemNode =
  {type: 'score', score: ScoreNode[]} |
  {type: 'template', template: string};

type ScoreNode = number | {i: number, score: number};

// This module will read metadata expressions and return parsed metadata.

interface Metadata {
  scores: number[],
  suffix: string,
};

type Modifier = '?' | '*' | '+' | null;

interface Settings {generative?: boolean};

// The public interface of this file follows.

const build_base_case = (
    modifier: Modifier, score: number, settings: Settings): string => {
  score = modifier === '+' ? score : 0;
  const transform = `builtin_base_cases['${modifier}']`;
  return settings.generative ? `(= ${transform}) (! ${score})` : transform;
}

const build_recursive = (
    modifier: Modifier, score: number, settings: Settings): string => {
  const transform = `builtin_recursives['${modifier}']`;
  return settings.generative ? `(= ${transform}) (! ${score})` : transform;
}

const generate_header = (settings: Settings): string => {
  return settings.generative ? `
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
  if (!settings.generative) {
    result.suffix = `, transform: ${input}`;
    return result;
  }
  const grammar = Grammar.from_file('../dsl/metadata');
  for (const item of Parser.parse(grammar, input) as ItemNode[]) {
    if (item.type === 'score') {
      const score = item.score.map((x) => typeof x === 'number' ? x : 0);
      item.score.forEach((x) => {
        if (typeof x === 'number') return;
        if (!modifiers[x.i]) throw new Error(`Non-modifier scored: ${input}`);
        result.scores[x.i] += x.score;
      });
      result.suffix += `, score: ${score}`;
    } else if (item.type === 'template') {
      result.suffix += parse_template(item.template, modifiers);
    }
  }
  return result;
}

const parse_template = (input: string, modifiers: Modifier[]): string => {
  if (input.startsWith('builtin_')) return `, transform: ${input}`;
  const optional = modifiers.map((x) => x === '?' || x === '*');
  new Template(input, optional); // Check the template's syntax.
  const args = [input, optional].map((x) => JSON.stringify(x)).join(', ');
  return `, transform: new template.Template(${args})`;
}

const Metadata = {build_base_case, build_recursive, generate_header, parse};

export {Metadata};
