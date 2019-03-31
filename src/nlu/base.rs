use super::super::lib::base::{HashMap, Result};
use std::rc::Rc;

// Parsing, generation, and correction all return derivations. These methods
// may fail, and may take additional arguments, but the overall structure is:
//
//   - correct :: (Grammar, Derivation) -> Derivation
//   - generate :: (Grammar, Semantics) -> Derivation
//   - parse :: (Grammar, String) -> Derivation
//
// Every grammar has a merge-semantics-type T and a split-semantics-type S.
// Derivations expose a top-level value of type T that represents the overall
// semantics of an utterance. Generation takes a value of type S as input.

pub enum Child<'a, S, T> {
  Leaf(Rc<Match<T>>),
  Node(Rc<Derivation<'a, S, T>>),
}

pub struct Derivation<'a, S, T> {
  pub children: Vec<Child<'a, S, T>>,
  pub rule: &'a Rule<S, T>,
  pub value: T,
}

// The core lexer type. Call lex to turn an utterance into a sequence of tokens
// with leaf semantics. Call unlex to generate a token for some leaf semantics.
//
// When we lex a token, we store it in a matches dictionary keyed by headword
// (e.g. "to be" for "am" in English). The match value stores information about
// the actual lexed word, like its tense. A tense has grammatical categories
// as keys, like "count", "gender", and "person". For example, "am" could have
// {count: "singular", person: "1st"} as one of its tense.
//
// We allow a token to be associated with multiple tenses because of words like
// "hai" in Hindi, the copula for both the 2nd person singular intimate tense
// and the 3d person plural tense.

pub type Entry<T> = (f32, Rc<Match<T>>);

pub type Tense = HashMap<&'static str, &'static str>;

pub trait Lexer<S, T> {
  fn fix(&self, &Match<T>, &Tense) -> Vec<Rc<Match<T>>>;
  fn lex<'a: 'b, 'b>(&'a self, &'b str) -> Vec<Token<'b, T>>;
  fn tense(&self, &HashMap<String, String>) -> Result<Tense>;
  fn unlex(&self, &str, &S) -> Vec<Rc<Match<T>>>;
}

pub struct Match<T> {
  pub tenses: Vec<Tense>,
  pub texts: HashMap<&'static str, String>,
  pub value: T,
}

pub struct Token<'a, T> {
  pub matches: HashMap<&'a str, Entry<T>>,
  pub text: &'a str,
}

// The core grammar type. A grammar has a lexer along with a list of rules.
// Each term on a rule's right-hand-side is either a symbol or a token match.
// Rules also have "merge" and "split" callbacks for handling semantics during
// parsing and generation, respectively.
//
// Each rule also has correction data in its "precedence" and "tense" fields.
// The tense is a base tense for that rule, implied solely by using the rule.
// Most rules will not have a base tense.
//
// "precedence" is an ordered list of RHS term indices to visit when collecting
// tense information. For example, one rule for English noun phrases might be:
// "$NP -> $Determiner? $Count? $Adjs? $Noun". To correct $NP, we should visit
// ($Count, $Noun, $Determiner, $Adjs), so "precedence" is [1, 3, 0, 2]. When a
// category from a later term disagrees with one from an earlier term, we will
// correct the tense for the later term.
//
// Terms that are missing from precedence are still corrected, but their tense
// information is not propagated to other terms. For example, a sentence's
// subject and verb must agree, but its object is only checked internally.

pub struct Grammar<S, T> {
  pub key: Box<Fn(&S) -> String>,
  pub lexer: Box<Lexer<S, T>>,
  pub names: Vec<String>,
  pub rules: Vec<Rule<S, T>>,
  pub start: usize,
}

pub struct Rule<S, T> {
  pub lhs: usize,
  pub rhs: Vec<Term>,
  pub merge: Semantics<Fn(&[T]) -> T>,
  pub split: Semantics<Fn(&S) -> Vec<Vec<S>>>,
  pub precedence: Vec<usize>,
  pub tense: Tense,
}

pub struct Semantics<F: ?Sized> {
  pub callback: Box<F>,
  pub score: f32,
}

pub enum Term {
  Symbol(usize),
  Terminal(String),
}

// Some utilities implemented on the types above. We avoid deriving them
// because we must take care to avoid deep copies of grammar structures.

impl<'a, S, T> Clone for Child<'a, S, T> {
  fn clone(&self) -> Self {
    match self {
      Child::Leaf(x) => Child::Leaf(Rc::clone(x)),
      Child::Node(x) => Child::Node(Rc::clone(x)),
    }
  }
}

impl<'a, S, T> Derivation<'a, S, T> {
  pub fn new(children: Vec<Child<'a, S, T>>, rule: &'a Rule<S, T>) -> Self {
    let value = {
      let n = rule.rhs.len();
      assert!(children.len() == n);
      let mut values: Vec<T> = Vec::with_capacity(n);
      let target = values.as_mut_ptr();
      for i in 0..n {
        let source = match &children[i] {
          Child::Leaf(x) => &x.value,
          Child::Node(x) => &x.value,
        };
        unsafe { std::ptr::copy(source, target.offset(i as isize), 1) };
      }
      let slice = unsafe { std::slice::from_raw_parts(target, n) };
      (rule.merge.callback)(slice)
    };
    Derivation { children, rule, value }
  }

  pub fn matches(&self) -> Vec<Rc<Match<T>>> {
    let mut result = vec![];
    self.children.iter().for_each(|x| match x {
      Child::Leaf(x) => result.push(Rc::clone(x)),
      Child::Node(x) => result.append(&mut x.matches()),
    });
    result
  }
}
