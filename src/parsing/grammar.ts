import {Lexer} from './lexer';

// A Grammar is a list of rules along with an index to access them.

interface Grammar {
  by_name: {[name: string]: Rule[]},
  lexer: Lexer,
  max_index: number,
  rules: Rule[],
  start: string,
}

interface Rule {
  index: number,
  lhs: string,
  rhs: Term[],
  score: number,
  transform: Transform,
}

type Term = string | {text: string} | {type: string};

type Transform = {
  merge: (d: any[]) => any,
  split: (d: any) => {[index: number]: any}[],
}

// The output of the compiler is a GrammarSpec, a grammar without redundant
// index fields like by_name or max_index.

interface GrammarSpec {
  rules: RuleSpec[];
  start: string;
}

interface RuleSpec {
  lhs: string,
  rhs: Term[],
  score?: number,
  transform?: Transform,
}

// Finally, we implement some helpers for making use of grammars.

declare const require: any;

const cached = <T>(fn: (x: string) => T): ((x: string) => T) => {
  const cache: {[x: string]: T} = {};
  return (x: string) => cache[x] || (cache[x] = fn(x));
}

const default_transform = (size: number): Transform => ({
  merge: (d) => d,
  split: (d) => d instanceof Array && d.length === size ? [d] : [],
});

const failing_transform = (): Transform => ({
  merge: (d) => { throw new Error(`merge is unimplemented!`) },
  split: (d) => { throw new Error(`split is unimplemented!`) },
});

const from_code = cached((code: string): Grammar => {
  /* tslint:disable:no-eval */
  const {grammar, lexer} = <any>((x) => {
    const exports = {};
    eval(x);
    return exports;
  })(code);
  /* tslint:enable:no-eval */
  return from_spec(grammar, lexer);
});

const from_file = cached((filename: string): Grammar => {
  const {grammar, lexer} = require(filename);
  return from_spec(grammar, lexer);
});

const from_spec = (grammar: GrammarSpec, lexer: Lexer): Grammar => {
  const result: Grammar = {
    by_name: {},
    lexer,
    max_index: 0,
    rules: [],
    start: grammar.start,
  };
  grammar.rules.forEach((x) => {
    const score = x.score || 0;
    // TODO(skishore): Read from spec.transform after the compiler is fixed.
    const partial = (<any>x).transform ? {merge: (<any>x).transform} :
                    default_transform(x.rhs.length);
    const transform = Object.assign(failing_transform(), partial);
    const rule: Rule = {...x, index: result.max_index, score, transform};
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

export {Grammar, Rule};
