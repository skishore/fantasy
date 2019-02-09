use grammar::{Child, Derivation, Grammar, Rule, Term};
use rand::Rng;
use rustc_hash::FxHashMap;
use std::rc::Rc;

// We use a memo both to speed up generation and to avoid an infinite loop on
// recursive rules, such as the left-recursive "repeat" rules.

type Tree<'a, S, T> = Option<Child<'a, S, T>>;

struct Memo<'a, 'b: 'a, R: Rng, S: Clone, T: Clone> {
  by_name: Vec<Vec<&'b Rule<S, T>>>,
  grammar: &'b Grammar<S, T>,
  memo: FxHashMap<String, Tree<'a, S, T>>,
  rng: &'b mut R,
}

impl<'a, 'b, R: Rng, S: Clone, T: Clone> Memo<'a, 'b, R, S, T> {
  fn generate_from_list(&mut self, rules: &[&'b Rule<S, T>], value: &S) -> Tree<'a, S, T> {
    let scores: Vec<_> = rules
      .iter()
      .filter_map(|x| self.generate_from_rule(x, value).map(|y| ((2 as f32).powf(x.split.score), y)))
      .collect();
    let length = scores.len();
    let mut left = self.rng.gen::<f32>() * scores.iter().fold(0.0, |acc, x| acc + x.0);
    for (i, (score, derivation)) in scores.into_iter().enumerate() {
      left -= score;
      if left < 0.0 || i == length - 1 {
        return Some(derivation);
      }
    }
    None
  }

  fn generate_from_memo(&mut self, term: &Term, value: &S) -> Tree<'a, S, T> {
    let key = (self.grammar.key)(value);
    if self.memo.contains_key(&key) {
      self.memo.insert(key.clone(), None);
      let maybe = self.generate_from_term(term, value);
      self.memo.insert(key.clone(), maybe);
    }
    self.memo.get(&key).cloned().unwrap_or(None)
  }

  fn generate_from_rule(&mut self, rule: &'b Rule<S, T>, value: &S) -> Tree<'a, S, T> {
    let candidates = (rule.split.callback)(value);
    let mut options = Vec::with_capacity(candidates.len());
    'outer: for candidate in candidates.iter() {
      let mut children = Vec::with_capacity(rule.rhs.len());
      for i in 0..rule.rhs.len() {
        if let Some(derivation) = self.generate_from_memo(&rule.rhs[i], &candidate[i]) {
          children.push(derivation);
        } else {
          break 'outer;
        }
      }
      options.push(children);
    }
    self.sample(options).map(|x| Child::Node(Rc::new(Derivation::new(x, rule))))
  }

  fn generate_from_term(&mut self, term: &Term, value: &S) -> Tree<'a, S, T> {
    match term {
      Term::Symbol(x) => self.generate_from_usize(*x, value),
      Term::Terminal(x) => self.sample(self.grammar.lexer.unlex(x, value)).map(|y| Child::Leaf(y)),
    }
  }

  fn generate_from_usize(&mut self, lhs: usize, value: &S) -> Tree<'a, S, T> {
    let rules = unsafe { &*(&self.by_name[lhs] as *const Vec<&'b Rule<S, T>>) };
    self.generate_from_list(&rules, value)
  }

  fn sample<U>(&mut self, mut xs: Vec<U>) -> Option<U> {
    if xs.is_empty() {
      return None;
    }
    let index = self.rng.gen::<usize>() % xs.len();
    Some(xs.swap_remove(index))
  }
}
