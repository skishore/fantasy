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
type Memo<'a, T> = super::generator::Memo<'a, Option<T>, T>;

type Grammar<T> = super::base::Grammar<Option<T>, T>;
type Lexer<T> = dyn super::base::Lexer<Option<T>, T>;
type Rule<T> = super::base::Rule<Option<T>, T>;

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

  fn fill_memo(tree: &Derivation<'a, T>, memo: &mut Memo<'a, T>) {
    tree.children.iter().enumerate().for_each(|(i, x)| {
      let value = match x {
        Leaf(y) => y.value.clone(),
        Node(y) => y.value.clone(),
      };
      memo.insert((&tree.rule.rhs[i], None), Some(x.clone()));
      memo.insert((&tree.rule.rhs[i], Some(value)), Some(x.clone()));
      return if let Node(x) = x { State::fill_memo(x, memo) } else { () };
    });
  }

  // The tree rebuilding logic: first, memoize all subtrees; then, call the generator.

  fn check_rules(&self, rule: &Rule<T>) -> Vec<String> {
    let ok = rule.split.score != std::f32::NEG_INFINITY;
    return if ok { self.tense.check(&rule.tense) } else { vec!["Invalid phrasing.".to_string()] };
  }

  fn rebuild(&mut self, old: Rc<Derivation<'a, T>>) -> Rc<Derivation<'a, T>> {
    let mut memo = Memo::default();
    State::fill_memo(&old, &mut memo);
    let rules: Vec<_> = {
      let lhs = old.rule.lhs;
      let valid = |x: &&Rule<T>| x.lhs == lhs && self.check_rules(*x).is_empty();
      self.grammar.rules.iter().filter(valid).collect()
    };
    let value = Some(old.value.clone());
    let new = self.generator.generate_from_rules(memo, &mut self.rng, &rules, &value);
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
    let errors = self.tense.union_checked(&old.tenses);
    if errors.is_empty() {
      self.diff.push(Diff::Right(old.clone()));
      return old;
    }
    let mut new = old.clone();
    let options = self.grammar.lexer.fix(&*old, &self.tense);
    if !options.is_empty() {
      new = options[self.rng.gen::<usize>() % options.len()].clone();
      debug_assert!(self.tense.union_checked(&new.tenses).is_empty());
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

#[cfg(test)]
mod tests {
  use super::super::super::lib::base::HashMap;
  use super::super::super::payload::json::Json;
  use super::super::base::{Lexer, Semantics, Term, Token};
  use super::super::parser::Parser;
  use super::*;
  use test::Bencher;

  struct WordLexer();

  impl Lexer<Option<Json>, Json> for WordLexer {
    fn fix(&self, _: &Match<Json>, _: &Tense) -> Vec<Rc<Match<Json>>> {
      unimplemented!()
    }

    fn lex<'a: 'b, 'b>(&'a self, input: &'b str) -> Vec<Token<'b, Json>> {
      let iter = input.split(' ').into_iter().map(|x| {
        let mut matches = HashMap::default();
        let texts = vec![("latin", x.into())].into_iter().collect::<HashMap<_, _>>();
        matches.insert(x, (0.0, Rc::new(Match { tenses: vec![], texts, value: Json::default() })));
        Token { matches, text: x.into() }
      });
      iter.collect()
    }

    fn unlex(&self, name: &str, value: &Option<Json>) -> Vec<Rc<Match<Json>>> {
      if value.as_ref().map(|x| x.empty()).unwrap_or(true) {
        let texts = vec![("latin", name.into())].into_iter().collect::<HashMap<_, _>>();
        vec![Rc::new(Match { tenses: vec![], texts, value: Json::default() })]
      } else {
        vec![]
      }
    }
  }

  fn make_rule(lhs: usize, rhs: &str, template: &str, is: &[usize], tense: Tense) -> Rule<Json> {
    let rhs: Vec<_> = rhs.split(' ').filter(|x| !x.is_empty()).map(make_term).collect();
    let n = rhs.len();
    let template = Rc::new(Json::template(template).unwrap());
    let (merge, split) = (template.clone(), template.clone());
    let merge: Semantics<dyn Fn(&[Json]) -> Json> = Semantics {
      callback: Box::new(move |x| merge.merge(&x.iter().cloned().enumerate().collect())),
      score: 0.0,
    };
    let split: Semantics<dyn Fn(&Option<Json>) -> Vec<Vec<Option<Json>>>> = Semantics {
      callback: Box::new(move |x| {
        let mut result = vec![];
        for option in x.as_ref().map(|y| split.split(y)).unwrap_or(vec![vec![]]) {
          let mut entry = vec![None; n];
          option.into_iter().filter(|(i, _)| *i < n).for_each(|(i, y)| entry[i] = Some(y));
          result.push(entry);
        }
        result
      }),
      score: 0.0,
    };
    let precedence = if is.is_empty() { (0..n).into_iter().collect() } else { is.to_owned() };
    Rule { lhs, rhs, merge, split, precedence, tense }
  }

  fn make_term(term: &str) -> Term {
    if term.starts_with("$") {
      Term::Symbol(term[1..].parse().unwrap())
    } else {
      Term::Terminal(term.into())
    }
  }

  fn render<T>(matches: &[Rc<Match<T>>]) -> String {
    let texts = matches.iter().map(|x| x.texts.get("latin").map(|y| y.as_str()).unwrap_or("?"));
    texts.collect::<Vec<_>>().join(" ")
  }

  fn tense(code: &str) -> Tense {
    assert!(code.len() == 2);
    let mut result = HashMap::default();
    match &code[0..1] {
      "p" => result.insert("count", "plural"),
      "s" => result.insert("count", "singular"),
      "." => None,
      x => Err(format!("Invalid count: {}", x)).unwrap(),
    };
    match &code[1..2] {
      "f" => result.insert("gender", "female"),
      "m" => result.insert("gender", "male"),
      "." => None,
      x => Err(format!("Invalid gender: {}", x)).unwrap(),
    };
    Tense::new(&result).unwrap()
  }

  fn make_grammar() -> Grammar<Json> {
    Grammar {
      lexer: Box::new(WordLexer {}),
      names: "$Root $Num $Adjs $Noun $Adj $Extra".split(' ').map(|x| x.into()).collect(),
      rules: vec![
        make_rule(0, "$1 $2 $3 ", "{adjs: $1, count: $0, noun: $2}", &[0, 2, 1], tense("..")),
        make_rule(1, "ek       ", "1", &[], tense("s.")),
        make_rule(1, "do       ", "2", &[], tense("p.")),
        make_rule(2, "$2 $4    ", "[...$0, $1]", &[], tense("..")),
        make_rule(2, "         ", "null", &[], tense("..")),
        make_rule(3, "admi $5  ", "'man'", &[], tense("sm")),
        make_rule(3, "admiyo $5", "'man'", &[], tense("pm")),
        make_rule(3, "aurat $5 ", "'woman'", &[], tense("sf")),
        make_rule(3, "aurte $5 ", "'woman'", &[], tense("pf")),
        make_rule(4, "bara     ", "'big'", &[], tense("sm")),
        make_rule(4, "bare     ", "'big'", &[], tense("pm")),
        make_rule(4, "bari     ", "'big'", &[], tense(".f")),
        make_rule(4, "chota    ", "'small'", &[], tense("sm")),
        make_rule(4, "chote    ", "'small'", &[], tense("pm")),
        make_rule(4, "choti    ", "'small'", &[], tense(".f")),
        make_rule(5, "huh      ", "null", &[], tense("..")),
        make_rule(5, "um       ", "null", &[], tense("..")),
        make_rule(5, "         ", "null", &[], tense("..")),
      ],
      start: 0,
    }
  }

  #[test]
  fn correction_works() {
    let grammar = make_grammar();
    let tree = Parser::new(&grammar).parse("do chota bari admi huh").unwrap();
    assert_eq!(render(&tree.matches()), "do chota bari admi huh");

    let corrector = Corrector::new(&grammar);
    let mut rng = rand::SeedableRng::from_seed([17; 32]);
    for _ in 0..10 {
      let correction = corrector.correct(&mut rng, &tree);
      assert_eq!(render(&correction.tree.matches()), "do chote bare admiyo huh");
      let iter = correction.diff.into_iter().map(|x| match x {
        Diff::Right(_) => vec![],
        Diff::Wrong(x) => x.errors,
      });
      assert_eq!(
        iter.collect::<Vec<_>>(),
        vec![
          vec![],
          vec!["count should be plural (was: singular)"],
          vec!["gender should be male (was: female)"],
          vec!["count should be plural (was: singular)"],
        ]
      );
    }
  }

  #[bench]
  fn correction_benchmark(b: &mut Bencher) {
    let grammar = make_grammar();
    let tree = Parser::new(&grammar).parse("do chota bari admi huh").unwrap();
    let corrector = Corrector::new(&grammar);
    let mut rng = rand::SeedableRng::from_seed([17; 32]);
    b.iter(|| corrector.correct(&mut rng, &tree));
  }
}
