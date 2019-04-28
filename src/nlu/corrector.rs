use super::super::lib::base::HashMap;
use super::super::payload::base::Payload;
use super::base::Child::{Leaf, Node};
use super::base::{Match, Tense, Term};
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

type Memo<'a, T> = HashMap<(&'a Term, T), Child<'a, T>>;

struct State<'a, 'b, T: Payload> {
  diff: Vec<Diff<T>>,
  generator: &'b Generator<'a, T>,
  grammar: &'a Grammar<T>,
  rng: &'b mut Rng,
  tense: Tense,
}

impl<'a, 'b, T: Payload> State<'a, 'b, T> {
  // Some simple static helpers.

  fn clone_tree(tree: &Derivation<'a, T>) -> Derivation<'a, T> {
    let Derivation { children, rule, value } = tree;
    Derivation { children: children.clone(), rule, value: value.clone() }
  }

  fn clone_value(child: &Child<'a, T>) -> T {
    match child {
      Leaf(x) => x.value.clone(),
      Node(x) => x.value.clone(),
    }
  }

  fn get_memo(tree: &Derivation<'a, T>, memo: &mut Memo<'a, T>) {
    tree.children.iter().enumerate().for_each(|(i, x)| {
      memo.insert((&tree.rule.rhs[i], State::clone_value(x)), x.clone());
      if let Node(x) = x {
        State::get_memo(x, memo);
      }
    });
  }

  fn use_memo(memo: &Memo<'a, T>, tree: &mut Derivation<'a, T>) {
    for i in 0..tree.children.len() {
      if let Some(x) = memo.get(&(&tree.rule.rhs[i], State::clone_value(&tree.children[i]))) {
        tree.children[i] = x.clone();
      } else if let Node(ref mut x) = &mut tree.children[i] {
        let mut subtree = State::clone_tree(&x);
        State::use_memo(memo, &mut subtree);
        *x = Rc::new(subtree);
      }
    }
  }

  // The subtree rebuilding logic: first, regenerate; then, reuse old subtrees.

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
    if let Some(mut new) = new {
      let mut memo = HashMap::default();
      State::get_memo(&old, &mut memo);
      State::use_memo(&memo, &mut new);
      return Rc::new(new);
    }
    old
  }

  // The core recursive correction algorithm.

  fn recurse(&mut self, old: Child<'a, T>) -> Child<'a, T> {
    match old {
      Leaf(x) => Leaf(self.see_leaf(x)),
      Node(x) => Node(self.see_node(x)),
    }
  }

  fn see_leaf(&mut self, old: Rc<Match<T>>) -> Rc<Match<T>> {
    let errors = self.tense.union_checked(&old.tenses);
    if errors.is_empty() {
      self.diff.push(Diff::Right(old.clone()));
      return old.clone();
    }
    let mut new = old.clone();
    let options = self.grammar.lexer.fix(&*old, &self.tense);
    if !options.is_empty() {
      new = options[self.rng.gen::<usize>() % options.len()].clone();
      assert!(self.tense.union_checked(&new.tenses).is_empty());
    }
    let (old_matches, new_matches) = (vec![old.clone()], vec![new.clone()]);
    self.diff.push(Diff::Wrong(Wrong { errors, old_matches, new_matches }));
    new
  }

  fn see_node(&mut self, old: Rc<Derivation<'a, T>>) -> Rc<Derivation<'a, T>> {
    // Correct top-level issues by regenerating the whole subtree.
    let errors = self.check_rules(old.rule);
    let new = if errors.is_empty() { old.clone() } else { self.rebuild(old.clone()) };
    self.tense.union(&new.rule.tense);

    // Correct tense errors in each of the tree's children.
    let Derivation { children, rule, value } = new.borrow();
    let mut diff = vec![];
    let mut checked = vec![false; rule.rhs.len()];
    let mut children = children.clone();
    let mut child_diffs: Vec<_> = rule.rhs.iter().map(|_| vec![]).collect();
    std::mem::swap(&mut diff, &mut self.diff);
    for i in rule.precedence.iter().cloned() {
      checked[i] = true;
      children[i] = self.recurse(children[i].clone());
      std::mem::swap(&mut child_diffs[i], &mut self.diff);
    }
    let mut tense = Tense::default();
    std::mem::swap(&mut tense, &mut self.tense);
    for (i, _) in checked.into_iter().enumerate().filter(|x| !x.1) {
      children[i] = self.recurse(children[i].clone());
      std::mem::swap(&mut child_diffs[i], &mut self.diff);
      self.tense = Tense::default();
    }

    // Restore our original state and compute a diff.
    let new = Rc::new(Derivation { children, rule, value: value.clone() });
    std::mem::swap(&mut diff, &mut self.diff);
    std::mem::swap(&mut tense, &mut self.tense);
    if errors.is_empty() {
      child_diffs.into_iter().for_each(|mut x| self.diff.append(&mut x));
    } else {
      let (old_matches, new_matches) = (old.matches(), new.matches());
      self.diff.push(Diff::Wrong(Wrong { errors, old_matches, new_matches }));
    }
    new
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
    let mut state = State { diff: vec![], generator, grammar, rng, tense: Tense::default() };
    let new = state.see_node(Rc::new(State::clone_tree(tree)));
    Correction { diff: state.diff, tree: State::clone_tree(&new) }
  }
}
