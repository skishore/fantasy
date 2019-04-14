use super::super::payload::base::Payload;
use super::base::Child::{Leaf, Node};
use super::base::{Match, Tense};
use rand::Rng as RngTrait;
use std::borrow::Borrow;
use std::rc::Rc;

// Types that exist while the corrector is executing.

type Rng = rand::rngs::StdRng;

type Child<'a, T> = super::base::Child<'a, Option<T>, T>;
type Derivation<'a, T> = super::base::Derivation<'a, Option<T>, T>;
type Generator<'a, T> = super::generator::Generator<'a, Option<T>, T>;

type Grammar<T> = super::base::Grammar<Option<T>, T>;
type Lexer<T> = super::base::Lexer<Option<T>, T>;
type Rule<T> = super::base::Rule<Option<T>, T>;

struct Mapping<'a, T> {
  errors: Vec<String>,
  old_node: Child<'a, T>,
  new_node: Child<'a, T>,
}

struct State<'a, 'b, T: Payload> {
  generator: &'b Generator<'a, T>,
  grammar: &'a Grammar<T>,
  mapping: Vec<Mapping<'a, T>>,
  rng: &'b mut Rng,
  tense: Tense,
}

// Simple methods for checking tenses at a particular tree node.

impl<'a, 'b, T: Payload> State<'a, 'b, T> {
  // The subtree-rebuilding logic. TODO(skishore): Reuse as much as possible.

  fn check_rules(&self, rule: &Rule<T>) -> Vec<String> {
    let ok = rule.split.score != std::f32::NEG_INFINITY;
    return if ok { self.tense.check(&rule.tense) } else { vec!["Invalid phrasing.".to_string()] };
  }

  fn rebuild(&mut self, old: Rc<Derivation<'a, T>>) -> Rc<Derivation<'a, T>> {
    let value = unsafe {
      let mut value = std::mem::uninitialized();
      std::ptr::copy(&old.value, &mut value, 1);
      Some(value)
    };
    let rules: Vec<_> = {
      let lhs = old.rule.lhs;
      let valid = |x: &&Rule<T>| x.lhs == lhs && self.check_rules(*x).is_empty();
      self.grammar.rules.iter().filter(valid).collect()
    };
    let new = self.generator.generate_from_rules(&mut self.rng, &rules, &value);
    std::mem::forget(value);
    new.map(Rc::new).unwrap_or(old)
  }

  // The core recursive correction algorithm.

  fn recurse(&mut self, old: Child<'a, T>) -> Child<'a, T> {
    match old {
      Leaf(x) => Leaf(self.see_leaf(x)),
      Node(x) => Node(self.see_node(x)),
    }
  }

  fn see_leaf(&mut self, old: Rc<Match<T>>) -> Rc<Match<T>> {
    let mut new = old.clone();
    let errors = self.tense.union_checked(&old.tenses);
    if !errors.is_empty() {
      let options = self.grammar.lexer.fix(&*old, &self.tense);
      if !options.is_empty() {
        new = options[self.rng.gen::<usize>() % options.len()].clone();
        assert!(self.tense.union_checked(&new.tenses).is_empty());
      }
    }
    self.mapping.push(Mapping { errors, old_node: Leaf(old), new_node: Leaf(new.clone()) });
    new
  }

  fn see_node(&mut self, old: Rc<Derivation<'a, T>>) -> Rc<Derivation<'a, T>> {
    // Correct top-level issues by regenerating the whole subtree.
    let errors = self.check_rules(old.rule);
    let new = if errors.is_empty() { old.clone() } else { self.rebuild(old.clone()) };
    self.tense.union(&new.rule.tense);

    // Correct tense errors in each of the tree's children.
    let Derivation { children, rule, value } = new.borrow();
    let mut checked = vec![false; rule.rhs.len()];
    let mut children = children.clone();
    for i in rule.precedence.iter().cloned() {
      checked[i] = true;
      children[i] = self.recurse(children[i].clone());
    }
    let mut tense = Tense::default();
    std::mem::swap(&mut tense, &mut self.tense);
    for (i, _) in checked.into_iter().enumerate().filter(|x| !x.1) {
      children[i] = self.recurse(children[i].clone());
      self.tense = Tense::default();
    }
    std::mem::swap(&mut tense, &mut self.tense);

    let new = Rc::new(Derivation { children, rule, value: value.clone() });
    self.mapping.push(Mapping { errors, old_node: Node(old), new_node: Node(new.clone()) });
    new
  }
}

// A helper used to compute a diff between an input tree and its correction.

fn clone_tree<'a, T: Payload>(tree: &Derivation<'a, T>) -> Derivation<'a, T> {
  let Derivation { children, rule, value } = tree;
  Derivation { children: children.clone(), rule, value: value.clone() }
}

fn compute_diff<T>(mapping: &[Mapping<T>], new: &Child<T>, out: &mut Vec<Diff<T>>) {
  let f = |x: &&Mapping<T>| match (&x.new_node, new) {
    (Leaf(a), Leaf(b)) => Rc::ptr_eq(a, b),
    (Node(a), Node(b)) => Rc::ptr_eq(a, b),
    _ => false,
  };
  let m = mapping.iter().filter(f).next().unwrap();
  if m.errors.is_empty() {
    match new {
      Leaf(x) => out.push(Diff::Right(x.clone())),
      Node(x) => x.children.iter().for_each(|y| compute_diff(mapping, y, out)),
    }
  } else {
    let old_matches = get_matches(&m.old_node);
    let new_matches = get_matches(&m.new_node);
    let mut errors = m.errors.clone();
    errors.sort();
    out.push(Diff::Wrong(Wrong { errors, old_matches, new_matches }));
  }
}

fn get_matches<T>(child: &Child<T>) -> Vec<Rc<Match<T>>> {
  match child {
    Leaf(x) => vec![x.clone()],
    Node(x) => x.matches(),
  }
}

// The correction algorithm exposes a single method, "correct", which takes a Derivation
// and returns a new Derivation along with a Diff explaining why certain subtrees changed.

pub struct Correction<'a, T> {
  pub diff: Vec<Diff<T>>,
  pub tree: Derivation<'a, T>,
}

pub enum Diff<T> {
  Right(Rc<Match<T>>),
  Wrong(Wrong<T>),
}

pub struct Wrong<T> {
  pub errors: Vec<String>,
  pub old_matches: Vec<Rc<Match<T>>>,
  pub new_matches: Vec<Rc<Match<T>>>,
}

pub struct Corrector<'a, T: Payload> {
  generator: Generator<'a, T>,
  grammar: &'a Grammar<T>,
}

impl<'a, T: Payload> Corrector<'a, T> {
  pub fn new(grammar: &'a Grammar<T>) -> Self {
    Self { generator: Generator::new(grammar), grammar }
  }

  pub fn correct(&self, rng: &mut Rng, tree: &'a Derivation<'a, T>) -> Correction<'a, T> {
    let Self { generator, grammar } = self;
    let mut state = State { generator, grammar, mapping: vec![], rng, tense: Tense::default() };
    let new = state.see_node(Rc::new(clone_tree(tree)));
    let mut diff = vec![];
    compute_diff(&state.mapping, &Node(new.clone()), &mut diff);
    Correction { diff, tree: clone_tree(&new) }
  }
}
