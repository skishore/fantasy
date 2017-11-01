import {Option} from '../lib/base';
import {Grammar, Rule, Term} from './grammar';
import {Lexer, Match, Token} from './lexer';

const generate_from_rule = (
    grammar: Grammar, rule: Rule, value: Option<any>): Option<string[]> => {
  const candidates = value ? rule.transform.split(value.some) : [[]];
  const options: string[][] = [];
  for (const candidate of candidates) {
    const result = [];
    for (let i = 0; i < rule.rhs.length; i++) {
      const child = candidate.hasOwnProperty(i) ? {some: candidate[i]} : null;
      const term = generate_from_term(grammar, rule.rhs[i], child);
      if (term) { result.push(term.some); } else break;
    }
    if (result.length !== rule.rhs.length) break;
    options.push([].concat.apply([], result));
  }
  const option = sample(options);
  return option ? {some: option} : null;
}

const generate_from_symbol = (
    grammar: Grammar, symbol: string, value: Option<any>): Option<string[]> => {
  const options = (grammar.by_name[symbol] || [])
    .map((x) => generate_from_rule(grammar, x, value))
    .filter((x) => !!x);
  return sample(options);
}

const generate_from_term = (
    grammar: Grammar, term: Term, value: Option<any>): Option<string[]> => {
  if (typeof term === 'string') {
    return generate_from_symbol(grammar, term, value);
  }
  const text: string | null = (<any>term).text;
  const type: string = (<any>term).type;
  const result = !!text ? grammar.lexer.unlex_text(text, value)
                        : grammar.lexer.unlex_type(type, value);
  return !!result ? {some: [result.some]} : null;
}

const sample = <T>(xs: T[]): T | null => {
  return xs.length === 0 ? null : xs[Math.floor(Math.random() * xs.length)];
}

// The public interface of this module is currently a single static method.

const generate = (grammar: Grammar, value: any): Option<string[]> => {
  return generate_from_symbol(grammar, grammar.start, {some: value});
}

const Generator = {generate};

export {Generator};

// A quick test of the generator on a generative grammar.

const grammar = Grammar.from_file('../dsl/english');
console.log(Generator.generate(grammar, {name: 'judge'}));
