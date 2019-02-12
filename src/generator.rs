use base::{Child, Derivation, Grammar, Rule, Term};
use rand::Rng as RngTrait;
use rustc_hash::FxHashMap;
use std::collections::hash_map::Entry;
use std::rc::Rc;

// We use a memo both to speed up generation and to avoid an infinite loop on
// recursive rules, such as the left-recursive "repeat" rules.

type Rng = rand::rngs::StdRng;

type Tree<'a, S, T> = Option<Child<'a, S, T>>;

struct Memo<'a, 'b, S, T> {
  generator: &'a Generator<'a, S, T>,
  memo: FxHashMap<String, Tree<'a, S, T>>,
  rng: &'b mut Rng,
}

impl<'a, 'b, S, T> Memo<'a, 'b, S, T> {
  fn generate_from_list(&mut self, rules: &[&'a Rule<S, T>], value: &S) -> Tree<'a, S, T> {
    let scores: Vec<_> = {
      let f = |x: &&'a Rule<S, T>| {
        self.generate_from_rule(*x, value).map(|y| ((2 as f32).powf(x.split.score), y))
      };
      rules.into_iter().filter_map(f).collect()
    };
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

  fn generate_from_memo(&mut self, term: &'a Term, value: &S) -> Tree<'a, S, T> {
    let key = self.generator.key(term, value);
    match self.memo.entry(key.clone()) {
      Entry::Occupied(x) => return x.get().clone(),
      Entry::Vacant(x) => x.insert(None),
    };
    let maybe = self.generate_from_term(term, value);
    self.memo.insert(key, maybe.clone());
    maybe
  }

  fn generate_from_rule(&mut self, rule: &'a Rule<S, T>, value: &S) -> Tree<'a, S, T> {
    let candidates = (rule.split.callback)(value);
    let mut options = Vec::with_capacity(candidates.len());
    'outer: for candidate in candidates.iter() {
      let mut children = Vec::with_capacity(rule.rhs.len());
      for i in 0..rule.rhs.len() {
        if let Some(derivation) = self.generate_from_memo(&rule.rhs[i], &candidate[i]) {
          children.push(derivation);
        } else {
          continue 'outer;
        }
      }
      options.push(children);
    }
    self.sample(options).map(|x| Child::Node(Rc::new(Derivation::new(x, rule))))
  }

  fn generate_from_term(&mut self, term: &'a Term, value: &S) -> Tree<'a, S, T> {
    let lexer = &self.generator.grammar.lexer;
    match term {
      Term::Symbol(x) => self.generate_from_list(&self.generator.by_name[*x], value),
      Term::Terminal(x) => self.sample(lexer.unlex(x, value)).map(|y| Child::Leaf(y)),
    }
  }

  fn sample<U>(&mut self, mut xs: Vec<U>) -> Option<U> {
    if xs.is_empty() {
      return None;
    }
    let index = self.rng.gen::<usize>() % xs.len();
    Some(xs.swap_remove(index))
  }
}

// Our public interface has a simple "generate" entry point, but also supports
// generation from a list of rules, which is useful for correction.

struct Generator<'a, S, T> {
  by_name: Vec<Vec<&'a Rule<S, T>>>,
  grammar: &'a Grammar<S, T>,
}

impl<'a, S, T> Generator<'a, S, T> {
  fn new(grammar: &'a Grammar<S, T>) -> Self {
    let mut by_name: Vec<_> = grammar.names.iter().map(|_| vec![]).collect();
    grammar.rules.iter().for_each(|x| by_name[x.lhs].push(x));
    Self { by_name, grammar }
  }

  fn generate(&'a self, rng: &mut Rng, value: &S) -> Option<Derivation<'a, S, T>> {
    self.generate_from_rules(rng, &self.by_name[self.grammar.start], value)
  }

  fn generate_from_rules(
    &'a self,
    rng: &mut Rng,
    rules: &[&'a Rule<S, T>],
    value: &S,
  ) -> Option<Derivation<'a, S, T>> {
    let result = {
      let mut memo = Memo { generator: self, memo: FxHashMap::default(), rng };
      memo.generate_from_list(rules, value)
    };
    match result {
      Some(Child::Node(x)) => Rc::try_unwrap(x).ok(),
      _ => None,
    }
  }

  fn key(&self, term: &Term, value: &S) -> String {
    match term {
      Term::Symbol(x) => format!("%{}: {}", x, (self.grammar.key)(value)),
      Term::Terminal(x) => format!("${}: {}", x, (self.grammar.key)(value)),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use base::{Lexer, Match, Semantics, Tense, Token};
  use std::marker::PhantomData;
  use test::Bencher;

  type Split<S> = Box<Fn(&S) -> Vec<Vec<S>>>;

  #[derive(Default)]
  struct CharacterLexer<T: Default> {
    mark: PhantomData<T>,
  }

  impl<T: Default + PartialEq> Lexer<T, String> for CharacterLexer<T> {
    fn fix(&self, _: &Match<String>, _: &Tense) -> Vec<Rc<Match<String>>> {
      unimplemented!()
    }

    fn lex<'a: 'b, 'b>(&'a self, _: &'b str) -> Vec<Token<'b, String>> {
      unimplemented!()
    }

    fn unlex(&self, name: &str, value: &T) -> Vec<Rc<Match<String>>> {
      if name.len() == 1 && *value == T::default() {
        let (tenses, texts, value) = (vec![], FxHashMap::default(), name.to_string());
        vec![Rc::new(Match { tenses, texts, value })]
      } else {
        vec![]
      }
    }
  }

  trait Builder {
    fn score(self, score: f32) -> Self;
  }

  impl<S, T> Builder for Rule<S, T> {
    fn score(mut self, score: f32) -> Self {
      self.split.score = score;
      self
    }
  }

  fn make_rule<S: Clone>(lhs: usize, rhs: &str, f: Split<S>) -> Rule<S, String> {
    let merge: Semantics<Fn(&[String]) -> String> =
      Semantics { callback: Box::new(|x| x.join("")), score: 0.0 };
    let split: Semantics<Fn(&S) -> Vec<Vec<S>>> = Semantics { callback: f, score: 0.0 };
    let rhs = rhs.split(' ').filter(|x| !x.is_empty()).map(make_term).collect();
    Rule { lhs, rhs, merge, split, precedence: vec![], tense: FxHashMap::default() }
  }

  fn make_term(term: &str) -> Term {
    if term.starts_with("$") {
      Term::Symbol(term[1..].parse().unwrap())
    } else {
      Term::Terminal(term.to_string())
    }
  }

  fn check_number(n: usize) -> Split<f32> {
    Box::new(move |x| if *x == n as f32 { vec![vec![0.0]] } else { vec![] })
  }

  fn check_operator(f: Box<Fn(f32, f32) -> f32>) -> Split<f32> {
    Box::new(move |x| {
      let mut result = vec![];
      for a in 0..10 {
        for b in 0..10 {
          let (a, b) = (a as f32, b as f32);
          if f(a, b) == *x {
            result.push(vec![a, 0.0, b]);
          }
        }
      }
      result
    })
  }

  fn make_grammar(deepness: f32) -> Grammar<f32, String> {
    Grammar {
      key: Box::new(|x| format!("{}", x)),
      lexer: Box::new(CharacterLexer::default()),
      names: "$Root $Add $Mul $Num".split(' ').map(|x| x.to_string()).collect(),
      rules: vec![
        make_rule(0, "$1     ", Box::new(|x| vec![vec![*x]])),
        make_rule(1, "$2     ", Box::new(|x| vec![vec![*x]])).score(-deepness),
        make_rule(1, "$1 + $2", check_operator(Box::new(|a, b| a + b))),
        make_rule(1, "$1 - $2", check_operator(Box::new(|a, b| a - b))),
        make_rule(2, "$3     ", Box::new(|x| vec![vec![*x]])).score(-deepness),
        make_rule(2, "$2 * $3", check_operator(Box::new(|a, b| a * b))),
        make_rule(2, "$2 / $3", check_operator(Box::new(|a, b| a / b))),
        make_rule(3, "( $1 ) ", Box::new(|x| vec![vec![0.0, *x, 0.0]])),
        make_rule(3, "0      ", check_number(0)),
        make_rule(3, "1      ", check_number(1)),
        make_rule(3, "2      ", check_number(2)),
        make_rule(3, "3      ", check_number(3)),
        make_rule(3, "4      ", check_number(4)),
        make_rule(3, "5      ", check_number(5)),
        make_rule(3, "6      ", check_number(6)),
        make_rule(3, "7      ", check_number(7)),
        make_rule(3, "8      ", check_number(8)),
        make_rule(3, "9      ", check_number(9)),
      ],
      start: 0,
    }
  }

  #[test]
  fn generation_works() {
    let grammar = make_grammar(0.0);
    let generator = Generator::new(&grammar);
    let tests = vec![(0, "8/2/2"), (2, "2-2+2"), (3, "7-5"), (5, "7/7*(5-3)"), (6, "8/4")];
    for (index, expected) in tests {
      let rules = [&grammar.rules[index]];
      let mut rng = rand::SeedableRng::from_seed([17; 32]);
      let result = generator.generate_from_rules(&mut rng, &rules, &2.0).map(|x| x.value.clone());
      assert_eq!(result, Some(expected.to_string()));
    }
  }

  #[test]
  fn scoring_works() {
    let tests = vec![(6.0, "6-6+8/2/2"), (3.0, "8/2/2"), (-3.0, "4/2"), (-6.0, "2")];
    for (deepness, expected) in tests {
      let grammar = make_grammar(deepness);
      let generator = Generator::new(&grammar);
      let mut rng = rand::SeedableRng::from_seed([17; 32]);
      let result = generator.generate(&mut rng, &2.0).map(|x| x.value.clone());
      assert_eq!(result, Some(expected.to_string()));
    }
  }

  #[bench]
  fn generation_benchmark(b: &mut Bencher) {
    let grammar = make_grammar(0.0);
    let generator = Generator::new(&grammar);
    let mut rng = rand::SeedableRng::from_seed([17; 32]);
    b.iter(|| generator.generate(&mut rng, &2.0));
  }
}
