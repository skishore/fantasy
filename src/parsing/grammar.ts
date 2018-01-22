import {Lexer, Tense} from './lexer';

// A Grammar is a list of rules along with an index to access them.
//
// A "templated" grammar uses template syntax to define reversible transforms
// so that the same grammar rules can be used for parsing and generation.
// Scoring and syntax checking are only supported for templated grammars. See
// "test/lib/template.ts" for example templates and see "src/dsl/metadata.ts"
// for the syntax for defining templated grammar metadata.

interface Grammar {
  by_name: {[name: string]: Rule[]},
  lexer: Lexer,
  max_index: number,
  rules: Rule[],
  start: string,
  templated?: boolean,
}

interface Rule {
  index: number,
  lhs: string,
  rhs: Term[],
  score: number,
  syntaxes: Syntax[],
  transform: Transform,
}

interface Syntax {
  indices: number[],
  tense: Tense,
}

type Term = string | {text: string} | {type: string};

type Transform = {
  merge: (d: any[]) => any,
  split: (d: any) => {[index: number]: any}[],
}

// The output of the compiler is a GrammarSpec, a grammar without redundant
// index fields like by_name or max_index.

interface GrammarSpec {
  lexer: Lexer,
  rules: RuleSpec[];
  start: string;
  templated?: boolean,
}

interface RuleSpec {
  lhs: string,
  rhs: Term[],
  score?: number,
  syntaxes?: Syntax[],
  transform?: Transform | Transform['merge'],
}

// Finally, we implement some helpers for making use of grammars.

declare const require: any;

const cached = <T>(fn: (x: string) => T): ((x: string) => T) => {
  const cache: {[x: string]: T} = {};
  return (x: string) => cache[x] || (cache[x] = fn(x));
}

const coerce_transform = (
    input: RuleSpec['transform'] | void, size: number): Transform => {
  if (!input) return default_transform(size);
  const transform = <Transform>input;
  if (transform.merge && transform.split) return transform;
  return {
    merge: <Transform['merge']>input,
    split: () => { throw new Error('split is unimplemented!'); },
  };
}

const default_transform = (size: number): Transform => ({
  merge: (d) => d,
  split: (d) => d instanceof Array && d.length === size ? [d] : [],
});

const from_code = cached((code: string): Grammar => {
  return from_spec(<GrammarSpec>((x) => {
    const exports = {};
    /* tslint:disable:no-eval */
    eval(x);
    /* tslint:enable:no-eval */
    return exports;
  })(code));
});

const from_file = cached((filename: string): Grammar => {
  return from_spec(require(filename));
});

const from_spec = (grammar: GrammarSpec): Grammar => {
  const result: Grammar = {...grammar, by_name: {}, max_index: 0, rules: []};
  grammar.rules.forEach((x) => {
    const base = {score: 0, syntaxes: []};
    const transform = coerce_transform(x.transform, x.rhs.length);
    const rule: Rule = {...base, ...x, index: result.max_index, transform};
    (result.by_name[x.lhs] = result.by_name[x.lhs] || []).push(rule);
    result.max_index += x.rhs.length + 1;
    result.rules.push(rule);
  });
  return result;
}

const print_rule = (rule: Rule, cursor?: number): string => {
  const terms = rule.rhs.map(print_term);
  if (cursor != null) terms.splice(cursor, 0, '●');
  return `${rule.lhs} -> ${terms.join(' ')}`;
}

const print_term = (term: Term): string =>
    typeof term === 'string' ? term :
           (<any>term).type ? `%${(<any>term).type}` :
           JSON.stringify((<any>term).text);

const Grammar = {from_code, from_file, print_rule, print_term};

export {Grammar, Rule, Syntax, Term};
