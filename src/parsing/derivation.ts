import {Option, debug, flatten} from '../lib/base';
import {Grammar, Lexer, Match, Rule, Term, Token} from './base';

// Some private helpers used to lift a grammar to a grammar w/ derivations.

// tslint:disable-next-line:no-any
type D<T> = Derivation<any, T>;

const lift = <S, T>(rule: Rule<S, T>): Rule<S, Derivation<S, T>> => {
  const fn = (children: Derivation<S, T>[]) => {
    const value = rule.merge.fn(children.map(x => x.value));
    return {type: 'node', value, rule, children} as Derivation<S, T>;
  };
  return {...rule, merge: {...rule.merge, fn}};
};

const lift_match = <T>(term: Term, match: Match<T>): Match<D<T>> => {
  const {score, value} = match;
  return {score, value: {type: 'leaf', value, term, match}};
};

const lift_maybe = <T>(term: Term, x: Match<T> | null): Match<D<T>> | null => {
  return x && lift_match(term, x);
};

const lift_token = <T>(token: Token<T>): Token<D<T>> => {
  const text = token.text;
  const result: Token<D<T>> = {text, text_matches: {}, type_matches: {}};
  for (const x of [true, false]) {
    const k = x ? 'text' : 'type';
    const v = x ? 'text_matches' : 'type_matches';
    const [old_matches, new_matches] = [token[v], result[v]];
    // tslint:disable-next-line:forin
    for (const y in old_matches) {
      const term = {type: k, value: y} as Term;
      new_matches[y] = lift_match(term, old_matches[y]);
    }
  }
  return result;
};

// The core Derivation type. Used to lift a raw grammar output value into a
// derivation type that includes that value plus the parse tree.

type Derivation<S, T> =
  | {type: 'leaf'; value: T; term: Term; match: Match<T>}
  | {type: 'node'; value: T; rule: Rule<S, T>; children: Derivation<S, T>[]};

const derive = <S, T>(grammar: Grammar<S, T>): Grammar<S, Derivation<S, T>> => {
  const lexer: Lexer<S, Derivation<S, T>> = {
    lex: x => grammar.lexer.lex(x).map(lift_token),
    unlex: (x, y) => lift_maybe(x, grammar.lexer.unlex(x, y)),
  };
  const rules = grammar.rules.map(lift);
  return {...grammar, lexer, rules};
};

const matches = <S, T>(x: Derivation<S, T>): Match<T>[] =>
  x.type === 'leaf' ? [x.match] : flatten(x.children.map(matches));

const print = <S, T>(x: Derivation<S, T>, depth?: number): string => {
  const padding = Array(depth || 0)
    .fill('  ')
    .join('');
  if (x.type === 'leaf') {
    const lhs = `${x.term.type === 'type' ? '%' : ''}${x.term.value}`;
    return `${padding}${lhs} -> ${debug(x.value)}`;
  } else {
    const rhs = x.rule.rhs;
    const lines = [`${padding}${x.rule.lhs}:`];
    x.children.forEach((x, i) => lines.push(print(x, (depth || 0) + 1)));
    return lines.filter(x => !!x).join('\n');
  }
};

const Derivation = {derive, matches, print};

export {Derivation};
