import {Lexer, Tense} from './lexer';

// A Grammar is a list of rules along with an index to access them.
//
// A single grammar can either be used for parsing or for text generation.
// The 'score' and 'transform' fields have different interpretations for these
// two different types of grammars:
//
//  - For parsing, the overall score of a parse tree is the sum of the scores
//    of the rules used in the tree. For generation, it is the product.
//
//  - For parsing, transforms merge child semantics to yield parent semantics:
//
//      transform: (x: any[]) => any
//
//    For generation, transforms split parent semantics to produce candidate
//    child semantics lists. Child semantics that are not constrained are
//    assigned 'undefined' in these candidate lists:
//
//      transform: (x: any) => any[][]

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
  transform: Function,
}

interface Syntax {
  indices: number[],
  tense: Tense,
}

type Term = string | {text: string} | {type: string};

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
  transform?: Function,
}

// Finally, we implement some helpers for making use of grammars.

declare const require: any;

const cached = <T>(fn: (x: string) => T): ((x: string) => T) => {
  const cache: {[x: string]: T} = {};
  return (x: string) => cache[x] || (cache[x] = fn(x));
}

const from_code = cached((code: string): Grammar => {
  return from_spec(<GrammarSpec>((x) => {
    const exports = {};
    /* tslint:disable-next-line:no-eval */
    eval(x);
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
    const transform = x.transform || ((d: any) => d);
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
