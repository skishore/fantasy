import {Option} from '../lib/base';
import {Grammar, Rule, Term} from './grammar';
import {Lexer, Match, Token} from './lexer';

// We use a memo both to speed up generation and to avoid infinite loops on
// recursive rules, such as the left-recursive modifier rules.

interface Memo {
  grammar: Grammar,
  saved: {[key: string]: Option<string[]>},
}

const generate_from_memo = (
    memo: Memo, term: Term, value: Option<any>): Option<string[]> => {
  const key = JSON.stringify([term, value]);
  if (!memo.saved.hasOwnProperty(key)) {
    memo.saved[key] = null;
    memo.saved[key] = generate_from_term(memo, term, value);
  }
  return memo.saved[key];
}

const generate_from_rule = (
    memo: Memo, rule: Rule, value: Option<any>): Option<string[]> => {
  const candidates = value ? rule.transform.split(value.some) : [[]];
  const options: string[][] = [];
  for (const candidate of candidates) {
    const result = [];
    for (let i = 0; i < rule.rhs.length; i++) {
      const child = candidate.hasOwnProperty(i) ? {some: candidate[i]} : null;
      const term = generate_from_memo(memo, rule.rhs[i], child);
      if (term) { result.push(term.some); } else break;
    }
    if (result.length !== rule.rhs.length) break;
    options.push([].concat.apply([], result));
  }
  const option = sample(options);
  return option ? {some: option} : null;
}

const generate_from_symbol = (
    memo: Memo, symbol: string, value: Option<any>): Option<string[]> => {
  const options = (memo.grammar.by_name[symbol] || [])
    .map((x) => generate_from_rule(memo, x, value))
    .filter((x) => !!x);
  return sample(options);
}

const generate_from_term = (
    memo: Memo, term: Term, value: Option<any>): Option<string[]> => {
  if (typeof term === 'string') {
    return generate_from_symbol(memo, term, value);
  }
  const text: string | null = (<any>term).text;
  const type: string = (<any>term).type;
  const result = !!text ? memo.grammar.lexer.unlex_text(text, value)
                        : memo.grammar.lexer.unlex_type(type, value);
  return !!result ? {some: [result.some]} : null;
}

const sample = <T>(xs: T[]): T | null => {
  return xs.length === 0 ? null : xs[Math.floor(Math.random() * xs.length)];
}

// The public interface of this module is currently a single static method.

const generate = (grammar: Grammar, value: any): Option<string[]> => {
  const memo: Memo = {grammar, saved: {}};
  return generate_from_symbol(memo, grammar.start, {some: value});
}

const Generator = {generate};

export {Generator};

// A quick test of the generator on a generative grammar.

const grammar = Grammar.from_file('../dsl/english');
console.log(Generator.generate(grammar, {name: 'judge'}));
