import {debug, flatten} from '../lib/base';
import {Grammar, Term} from './base';

// Versions of the grammar component types computed from the grammar.

// tslint:disable-next-line:no-any
type Any = any;
type Base = Grammar<Any, Any>;
type S<G extends Base> = (G['args'] & Any[])[0];
type T<G extends Base> = (G['args'] & Any[])[1];
type U<G extends Base> = (G['args'] & Any[])[2];

type Lexer<G extends Base> = G['lexer'];
type Match<G extends Base> = Token<G>['text_matches'][''];
type Rule<G extends Base> = G['rules'][0];
type Token<G extends Base> = ReturnType<G['lexer']['lex']>[0];

// Some private helpers used to lift a grammar to a grammar w/ derivations.

const lift1 = <G extends Base>(rule: Rule<G>): Rule<Lift<G>> => {
  // TODO(skishore): make this line type-safe.
  // tslint:disable-next-line:no-any
  const result: Rule<Lift<G>> = {...(rule as any), merge: {...rule.merge}};
  result.merge.fn = (children: Derivation<G>[]) => {
    const value = rule.merge.fn(children.map(x => x.value));
    return {type: 'node', value, rule: result, children};
  };
  return result;
};

const lift2 = <G extends Base>(term: Term, match: Match<G>): Match<Lift<G>> => {
  const {score, value} = match;
  return {score, value: {type: 'leaf', value, term, match}};
};

const lift3 = <G extends Base>(term: Term, match: Match<G> | null) => {
  return match && lift2(term, match);
};

const lift4 = <G extends Base>(token: Token<G>): Token<Lift<G>> => {
  const text = token.text;
  const result: Token<Lift<G>> = {text, text_matches: {}, type_matches: {}};
  for (const x of [true, false]) {
    const k = x ? 'text' : 'type';
    const v = x ? 'text_matches' : 'type_matches';
    const [old_matches, new_matches] = [token[v], result[v]];
    // tslint:disable-next-line:forin
    for (const y in old_matches) {
      const term = {type: k, value: y} as Term;
      new_matches[y] = lift2(term, old_matches[y]);
    }
  }
  return result;
};

const lift5 = <G extends Base>(lexer: Lexer<G>): Lexer<Lift<G>> => ({
  lex: x => lexer.lex(x).map(x => lift4<G>(x)),
  unlex: (x, y) => lift3(x, lexer.unlex(x, y)),
});

// In addition to returning the base grammar's value type, a derived grammar
// returns a parse tree that shows how that value was computed.

type Lift<G extends Base> = Grammar<S<G>, Derivation<G>, U<G>>;

type Derivation<G extends Base> =
  | {type: 'leaf'; value: T<G>; term: Term; match: Match<G>}
  | {type: 'node'; value: T<G>; rule: Rule<Lift<G>>; children: Derivation<G>[]};

const derive = <G extends Base>(grammar: G): Lift<G> => ({
  lexer: lift5(grammar.lexer),
  rules: grammar.rules.map(x => lift1<G>(x)),
  start: grammar.start,
});

const matches = <G extends Base>(x: Derivation<G>): Match<Lift<G>>[] =>
  x.type === 'leaf' ? [x.match] : flatten(x.children.map(matches));

const print = <G extends Base>(x: Derivation<G>, depth?: number): string => {
  const padding = Array(depth || 0)
    .fill('  ')
    .join('');
  if (x.type === 'leaf') {
    // TODO(skishore): Find a better way to render leaves, e.g. by text.
    // The problem is that the generation algorithm doesn't produce text.
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

export {Derivation, Lift};
