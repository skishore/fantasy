use rustc_hash::FxHashMap;

// Definitions for the core lexer type.

pub trait Lexer<S: Clone, T: Clone> {
  fn fix<'a, 'b: 'a>(&'b self, &'a Match<'a, T>, &'a Tense) -> Vec<Match<'a, T>>;
  fn lex<'a, 'b: 'a>(&'b self, &'b str) -> Vec<Token<'a, T>>;
  fn unlex(&self, S) -> Vec<Match<T>>;
}

#[derive(Clone)]
pub struct Match<'a, T: Clone> {
  pub data: &'a TermData,
  pub score: f32,
  pub value: T,
}

pub struct Token<'a, T: Clone> {
  pub matches: FxHashMap<&'a str, Match<'a, T>>,
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
  pub data: RuleData,
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

// These annotations are only used for correction.

pub type Tense = FxHashMap<String, String>;

#[derive(Default)]
pub struct RuleData {
  pub precedence: Vec<usize>,
  pub tense: Tense,
}

#[derive(Default)]
pub struct TermData {
  pub tenses: Vec<Tense>,
  pub text: FxHashMap<String, String>,
}

// The return type of any grammar operation.

pub enum Child<'a, S: Clone, T: Clone> {
  Leaf(Match<'a, T>),
  Node(Derivation<'a, S, T>),
}

pub struct Derivation<'a, S: Clone, T: Clone> {
  pub children: Vec<Child<'a, S, T>>,
  pub rule: &'a Rule<S, T>,
  pub value: T,
}
