// The Lexer interface.

interface Lexer<T> {
  lex: (input: string) => Token<T>[];
}

interface Token<T> {
  score: number;
  text: string;
  value: T;
}

// The Grammar interface.

interface Grammar<T> {
  lexer: Lexer<T>;
  rules: Rule<T>[];
  start: string;
}

interface Rule<T> {
  fn: (xs: T[]) => T;
  lhs: string;
  rhs: Term[];
  score: number;
}

type Term = {type: 'name'; value: string} | {type: 'text'; value: string};

export {Grammar, Lexer, Rule, Term, Token};
