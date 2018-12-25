// The Lexer interface.

interface Lexer<S, T> {
  lex: (input: string) => Token<T>[];
  unlex: (term: Term, value: S) => Match<T>[];
}

interface Match<T> {
  score: number;
  value: T;
}

interface Token<T> {
  text: string;
  text_matches: {[text: string]: Match<T>};
  type_matches: {[type: string]: Match<T>};
}

// The Grammar interface.

interface Grammar<S, T> {
  key: (s: S) => string;
  lexer: Lexer<S, T>;
  rules: Rule<S, T>[];
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
