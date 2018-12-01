// The Lexer interface. The optional type variable V is a "match annotation",
// which represents extra data that can be attached to each match.

interface Lexer<S, T, V = {}> {
  lex: (input: string) => Token<T, V>[];
  unlex: (term: Term, value: S) => (Match<T> & V) | null;
}

interface Match<T> {
  score: number;
  value: T;
}

interface Token<T, V = {}> {
  text: string;
  text_matches: {[text: string]: Match<T> & V};
  type_matches: {[type: string]: Match<T> & V};
}

// The Grammar interface. The optional type variable U is a "rule annotation",
// which represents extra data that can be attached to each rule.

interface Grammar<S, T, U = {}, V = {}> {
  args?: [S, T, U, V];
  lexer: Lexer<S, T, V>;
  rules: (Rule<S, T> & U)[];
  start: string;
}

interface Rule<S, T> {
  lhs: string;
  rhs: Term[];
  merge: {score: number; fn: (xs: T[]) => T};
  split: {score: number; fn: (x: S) => S[][]};
}

type Term =
  | {type: 'name'; value: string}
  | {type: 'text'; value: string}
  | {type: 'type'; value: string};

export {Grammar, Lexer, Match, Rule, Term, Token};
