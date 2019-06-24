// The Lexer interface.

interface Lexer<S, T> {
  lex: (input: string) => Token<T>[];
  unlex: (name: string, value: S) => Match<T>[];
}

interface Match<T> {
  score: number;
  value: T;
}

interface Token<T> {
  matches: {[name: string]: Match<T>};
  text: string;
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

interface Term {
  name: string;
  terminal: boolean;
}

export {Grammar, Lexer, Match, Rule, Term, Token};
