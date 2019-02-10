use rustc_hash::FxHashMap;
use std::rc::Rc;

// Parsing, generation, and correction all return derivations. These methods
// may fail, and may take additional arguments, but the overall structure is:
//
//   - correct :: (Grammar, Derivation) -> Derivation
//   - generate :: (Grammar, Semantics) -> Derivation
//   - parse: (Grammar, String) -> Derivation
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

pub type Entry<T> = (f32, Rc<Match<T>>);

pub trait Lexer<S, T> {
  fn fix(&self, &Match<T>, &Tense) -> Vec<Rc<Match<T>>>;
  fn lex<'a: 'b, 'b>(&'a self, &'b str) -> Vec<Token<'b, T>>;
  fn unlex(&self, &str, &S) -> Vec<Rc<Match<T>>>;
}

pub struct Match<T> {
  pub data: TermData,
  pub value: T,
}

pub struct Token<'a, T> {
  pub matches: FxHashMap<&'a str, Entry<T>>,
  pub text: &'a str,
}

// The core grammar type. A grammar has a lexer along with a list of rules.
// Each term on a rule's right-hand-side is either a symbol or a token match.
// Rules also have "merge" and "split" callbacks for handling semantics during
// parsing and generation, respectively.

pub struct Grammar<S, T> {
  pub key: Box<Fn(&S) -> String>,
  pub lexer: Box<Lexer<S, T>>,
  pub names: Vec<String>,
  pub rules: Vec<Rule<S, T>>,
  pub start: usize,
}

pub struct Rule<S, T> {
  pub data: RuleData,
  pub lhs: usize,
  pub rhs: Vec<Term>,
  pub merge: Semantics<Fn(&[T]) -> T>,
  pub split: Semantics<Fn(&S) -> Vec<Vec<S>>>,
}

pub struct Semantics<F: ?Sized> {
  pub callback: Box<F>,
  pub score: f32,
}

pub enum Term {
  Symbol(usize),
  Terminal(String),
}

// The following annotations are used only for correction. These types are
// the least-stable portions of the grammar API.
//
// Each raw lexed token must list a set of tenses in which it makes sense.
// We accept a list because a word make be appropriate in multiple tenses:
// for example, in Hindi, "hai" is the copula for the 2nd person singular
// intimate tense and also for the 3rd person plural.
//
// Each rule must provide a base tense (implied by the rule alone) and a list
// of terms to check tenses for, in order. The overall tense for the rule node
// is the union of the base tense and the term tenses, in that order; if any
// two terms disagree on a grammatical category, the later one is wrong.
//
// Most rules will not have a base tense, which means we will just compute the
// node's tense recursively by visiting the terms in order of precedence.
//
// Finally, terms that don't appear in the precedence list still have their
// tense checked internally, just in a separate context from the main check.

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
}
