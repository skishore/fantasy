use rustc_hash::FxHashMap;

// Definitions for the core lexer type.

pub trait Lexer<S: Clone, T: Clone> {
  fn lex<'a: 'c, 'b: 'c, 'c>(&'a self, &'b str) -> Vec<Token<'c, T>>;
  fn unlex(&self, value: S) -> Vec<Match<T>>;
}

pub struct Match<T: Clone> {
  pub score: f32,
  pub value: T,
}

pub struct Token<'a, T: Clone> {
  pub matches: FxHashMap<&'a str, Match<T>>,
  pub text: &'a str,
}

// Definitions for the core grammar type.

pub struct Grammar<S: Clone, T: Clone> {
  pub lexer: Box<Lexer<S, T>>,
  pub names: Vec<String>,
  pub rules: Vec<Rule<S, T>>,
  pub start: usize,
}

pub struct Rule<S: Clone, T: Clone> {
  pub lhs: usize,
  pub rhs: Vec<Term>,
  pub merge: Semantics<Fn(&[T]) -> T>,
  pub split: Semantics<Fn(S) -> Vec<Vec<S>>>,
}

pub struct Semantics<F: ?Sized> {
  pub callback: Box<F>,
  pub score: f32,
}

pub enum Term {
  Symbol(usize),
  Terminal(String),
}
