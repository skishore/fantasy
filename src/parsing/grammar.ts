// The Lexer interface.

interface Lexer<S, T> {
  lex: (input: string) => Token<T>[];
  unlex_text: (text: string, value: S) => Token<T> | null;
  unlex_type: (type: string, value: S) => Token<T> | null;
}

interface Token<T> {
  score: number;
  text: string;
  value: T;
}

// The Grammar interface.

interface Grammar<S, T> {
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

type Term = {type: 'name'; value: string} | {type: 'text'; value: string};

export {Grammar, Lexer, Rule, Term, Token};
