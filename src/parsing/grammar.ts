import {Lexer} from './lexer';

// A Grammar is a list of rules along with an index to access them.

interface Grammar {
  by_name: {[name: string]: Rule[]},
  max_index: number,
  rules: Rule[],
  start: string,
}

type Rule = {
  index: number,
  lhs: string,
  rhs: Term[],
  score: number,
  transform?: Transform,
}

type Term = string | {text: string} | {type: string};

type Transform = (xs: any[]) => any;

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

const from_code = (code: string): [Grammar, Lexer] => {
  const {grammar, lexer} = ((x) => eval(x))(code);
  return [from_spec(grammar), lexer]
}

const from_file = (filename: string): [Grammar, Lexer] => {
  const {grammar, lexer} = require(filename);
  return [from_spec(grammar), lexer]
}

const from_spec = (spec: GrammarSpec): Grammar => {
  const result: Grammar = {by_name: {}, max_index: 0, rules: [], start: ''};
  spec.rules.forEach((x) => {
    const rule: Rule = {...x, index: result.max_index, score: x.score || 0};
    (result.by_name[x.lhs] = result.by_name[x.lhs] || []).push(rule);
    result.max_index += x.rhs.length + 1;
    result.rules.push(rule);
  });
  result.start = spec.start;
  return result;
}

const print_rule = (rule: Rule, cursor?: number): string => {
  const print_term = (term: Term) =>
      typeof term === 'string' ? term :
             (<any>term).type ? `%${(<any>term).type}` :
             JSON.stringify((<any>term).text);
  const terms = rule.rhs.map(print_term);
  if (cursor != null) terms.splice(cursor, 0, '●');
  return `${rule.lhs} -> ${terms.join(' ')}`;
}

const Grammar = {from_code, from_file, print_rule};

export {Grammar, Rule};