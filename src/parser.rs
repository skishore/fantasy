use rustc_hash::FxHashMap;
use std::collections::HashMap;
use typed_arena::Arena;

// Definitions for the core lexer type.

pub trait Lexer<T: Clone> {
  fn lex(&self, &str) -> Vec<Token<T>>;
}

pub struct Match<T: Clone> {
  score: f32,
  value: T,
}

pub struct Token<T: Clone> {
  matches: HashMap<String, Match<T>>,
  text: String,
}

// Definitions for the core grammar type.

pub struct Grammar<T: Clone> {
  lexer: Box<Lexer<T>>,
  names: Vec<String>,
  rules: Vec<Rule<T>>,
  start: Symbol,
}

pub struct Rule<T: Clone> {
  callback: Box<Fn(&[T]) -> T>,
  lhs: Symbol,
  rhs: Vec<Term>,
  score: f32,
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
pub struct Symbol(usize);

pub enum Term {
  Symbol(Symbol),
  Terminal(String),
}

// A State is a rule accompanied with a "cursor" and a "start", where the
// cursor is the position in the rule up to which we have a match and the
// start is the token from which this match started.

#[derive(Clone)]
struct Candidate<'a, T: Clone> {
  next: Next<'a, T>,
  prev: *const State<'a, T>,
}

#[derive(Clone)]
enum Next<'a, T: Clone> {
  Leaf(&'a Match<T>),
  Node(*const State<'a, T>),
}

#[derive(Clone)]
struct State<'a, T: Clone> {
  candidate: Option<Candidate<'a, T>>,
  cursor: usize,
  rule: &'a IndexedRule<'a, T>,
  score: f32,
  start: usize,
}

impl<'a, T: Clone> Copy for Candidate<'a, T> {}
impl<'a, T: Clone> Copy for Next<'a, T> {}
impl<'a, T: Clone> Copy for State<'a, T> {}

impl<'a, T: Clone> State<'a, T> {
  fn new(cursor: usize, rule: &'a IndexedRule<'a, T>, start: usize) -> Self {
    Self { candidate: None, cursor, rule, score: std::f32::NEG_INFINITY, start }
  }

  fn evaluate(&self) -> T {
    assert!(self.cursor == self.rule.rhs.len());
    let mut xs = Vec::with_capacity(self.cursor);
    let mut current = self;
    for _ in 0..self.cursor {
      let candidate = current.candidate.as_ref().unwrap();
      xs.push(match &candidate.next {
        Next::Leaf(x) => x.value.clone(),
        Next::Node(x) => unsafe { (**x).evaluate() },
      });
      current = unsafe { &*candidate.prev };
    }
    xs.reverse();
    (self.rule.callback)(&xs)
  }
}

// A Chart is a list of Earley parser states with links to each other.
// Its fields have the following sizes, where n is the number of tokens,
// r is the number of rule cursor positions, and s is the number of symbols:
//
//  candidates: An Arena that stores derivation candidates linked list nodes.
//              In theory, we could deallocate some candidates after finishing
//              a column, but in practice it's just as fast to do so later.
//
//  states: An Arena that stores and has ownership of all parser states.
//          It stores up to 1 state for each (start, end, cursor) triple.
//          Maximum size: n * n * r.
//
//  wanted: A hash table mapping (end, symbol) pairs to a list of states
//          ending at that token that predict that symbol to be next.
//          Maximum size: n * s.
//
// A Column has additional data structures that are used to process states
// ending at a single token index. For these structures, "end" is implicit
// in the column itself:
//
//  candidates: A hash table mapping (start, cursor) to a linked list of
//              derivation candidates for the (start, end, cursor) state.
//              Maximum size: n * r.
//
//  completed: A list of states with a start of 0 ending here.
//
//  scannable: A list of states with a cursor at a terminal ending here.
//
//  states: A list of states ending here.

struct Candidates<'a, T: Clone> {
  candidate: Candidate<'a, T>,
  next: *const Candidates<'a, T>,
}

struct Chart<'a, T: Clone> {
  grammar: &'a IndexedGrammar<'a, T>,
  candidates: Arena<Candidates<'a, T>>,
  completed: Vec<*const State<'a, T>>,
  scannable: Vec<*const State<'a, T>>,
  states: Arena<State<'a, T>>,
  wanted: FxHashMap<usize, Vec<*const State<'a, T>>>,
}

struct Column<'a, T: Clone> {
  candidates: FxHashMap<usize, *const Candidates<'a, T>>,
  completed: Vec<*const State<'a, T>>,
  scannable: Vec<*const State<'a, T>>,
  states: Vec<*const State<'a, T>>,
}

impl<'a, T: Clone> Chart<'a, T> {
  fn new(grammar: &'a IndexedGrammar<T>) -> Self {
    let (candidates, states) = (Arena::new(), Arena::new());
    let wanted = FxHashMap::default();
    Self { grammar, candidates, completed: vec![], scannable: vec![], states, wanted }
  }

  fn result(&self) -> Option<T> {
    let mut best_score = std::f32::NEG_INFINITY;
    let mut best_state = None;
    for state in &self.completed {
      let state = unsafe { &**state };
      if state.rule.lhs == self.grammar.start && state.score > best_score {
        best_score = state.score;
        best_state = Some(state);
      }
    }
    best_state.map(|x| x.evaluate())
  }

  fn score(
    &self,
    candidates: &FxHashMap<usize, *const Candidates<'a, T>>,
    state: *const State<'a, T>,
  ) -> f32 {
    let state = unsafe { &mut *(state as *mut State<'a, T>) };
    if state.score > std::f32::NEG_INFINITY {
      return state.score;
    } else if state.cursor == 0 {
      state.score = state.rule.score;
      return state.score;
    }
    let mut best_candidate = None;
    let mut best_score = std::f32::NEG_INFINITY;
    let index = state.start * self.grammar.max_index + state.rule.index + state.cursor;
    let mut node = candidates.get(&index).cloned().unwrap_or(std::ptr::null());
    while !node.is_null() {
      let Candidates { candidate, next: next_node } = unsafe { &*node };
      node = *next_node;
      let next_score = match candidate.next {
        Next::Leaf(x) => x.score,
        Next::Node(x) => self.score(candidates, x),
      };
      let prev_score = self.score(candidates, candidate.prev) + next_score;
      if prev_score > best_score {
        best_candidate = Some(*candidate);
        best_score = prev_score;
      }
    }
    assert!(best_candidate.is_some());
    assert!(best_score > std::f32::NEG_INFINITY);
    state.candidate = best_candidate;
    state.score = best_score;
    state.score
  }

  fn step(&mut self, next: Next<'a, T>, state: *const State<'a, T>, column: &mut Column<'a, T>) {
    let state = unsafe { &*state };
    let offset = state.start * self.grammar.max_index + state.rule.index + state.cursor + 1;
    let values = column.candidates.entry(offset).or_insert(std::ptr::null());
    if values.is_null() {
      let state = State::new(state.cursor + 1, state.rule, state.start);
      column.states.push(self.states.alloc(state));
    }
    let candidate = Candidate { next, prev: state };
    *values = self.candidates.alloc(Candidates { candidate, next: *values });
  }

  fn update(&mut self, index: usize, token: Option<&'a Token<T>>) {
    let candidates = FxHashMap::default();
    let mut nullable = FxHashMap::default();
    let mut column = Column { candidates, completed: vec![], scannable: vec![], states: vec![] };

    let mut scannable = vec![];
    let mut wanted = FxHashMap::default();
    std::mem::swap(&mut scannable, &mut self.scannable);
    std::mem::swap(&mut wanted, &mut self.wanted);

    if index == 0 {
      for rule in &self.grammar.by_name[self.grammar.start.0] {
        column.states.push(self.states.alloc(State::new(0, rule, index)));
      }
    } else if let Some(token) = token {
      scannable.iter().for_each(|x| {
        let state = unsafe { &**x };
        if let Term::Terminal(t) = &state.rule.rhs[state.cursor] {
          if let Some(m) = token.matches.get(t) {
            self.step(Next::Leaf(m), state, &mut column);
          }
        }
      });
    }

    let mut i = 0;
    while i < column.states.len() {
      let state = unsafe { &*column.states[i] };
      i += 1;
      if state.cursor == state.rule.rhs.len() {
        let j = state.start * self.grammar.max_index + state.rule.lhs.0;
        if let Some(wanted) = &wanted.get(&j) {
          wanted.iter().for_each(|x| self.step(Next::Node(state), *x, &mut column));
        }
        if state.start == 0 {
          column.completed.push(state);
        }
        if state.start == index {
          nullable.entry(state.rule.lhs.0).or_insert(vec![]).push(state);
        }
      } else {
        match state.rule.rhs[state.cursor] {
          Term::Symbol(lhs) => {
            if let Some(nullable) = nullable.get(&lhs.0) {
              nullable.iter().for_each(|x| self.step(Next::Node(*x), state, &mut column));
            }
            let j = index * self.grammar.max_index + lhs.0;
            let wanted = wanted.entry(j).or_insert(vec![]);
            if wanted.is_empty() {
              for rule in &self.grammar.by_name[lhs.0] {
                column.states.push(self.states.alloc(State::new(0, rule, index)));
              }
            }
            wanted.push(state);
          }
          Term::Terminal(_) => column.scannable.push(state),
        }
      }
    }

    column.states.iter().for_each(|x| {
      self.score(&column.candidates, *x);
    });
    std::mem::swap(&mut column.completed, &mut self.completed);
    std::mem::swap(&mut column.scannable, &mut self.scannable);
    std::mem::swap(&mut wanted, &mut self.wanted);
  }
}

// An IndexedGrammar is a variant on a grammar that has a few additional
// fields for fast lookups during parsing, like a per-cursor index number.

struct IndexedGrammar<'a, T: Clone> {
  by_name: Vec<Vec<IndexedRule<'a, T>>>,
  max_index: usize,
  names: &'a [String],
  start: Symbol,
}

struct IndexedRule<'a, T: Clone> {
  callback: &'a Fn(&[T]) -> T,
  index: usize,
  lhs: Symbol,
  rhs: &'a [Term],
  score: f32,
}

fn index<T: Clone>(grammar: &Grammar<T>) -> IndexedGrammar<T> {
  let mut index = 0;
  let mut by_name: Vec<_> = grammar.names.iter().map(|_| vec![]).collect();
  for rule in &grammar.rules {
    let Rule { callback, lhs, rhs, score } = rule;
    let indexed = IndexedRule { callback: &**callback, index, lhs: *lhs, rhs: &rhs, score: *score };
    by_name[rule.lhs.0].push(indexed);
    index += rule.rhs.len() + 1;
  }
  IndexedGrammar { by_name, max_index: index, names: &grammar.names, start: grammar.start }
}

pub fn parse<T: Clone>(grammar: &Grammar<T>, input: &str) -> Option<T> {
  let indexed = index(grammar);
  let tokens = grammar.lexer.lex(input);
  let mut chart = Chart::new(&indexed);
  chart.update(0, None);
  for (i, token) in tokens.iter().enumerate() {
    chart.update(i + 1, Some(token));
  }
  chart.result()
}

// A quick smoke test of the logic above.

struct CharacterLexer {}

impl Lexer<i32> for CharacterLexer {
  fn lex(&self, input: &str) -> Vec<Token<i32>> {
    input
      .chars()
      .map(|x| {
        let mut matches = HashMap::new();
        matches.insert(x.to_string(), Match { score: 0.0, value: 0 });
        Token { matches, text: x.to_string() }
      })
      .collect()
  }
}

fn make_grammar() -> Grammar<i32> {
  Grammar {
    lexer: Box::new(CharacterLexer {}),
    names: vec!["$Root".to_string(), "$Add".to_string(), "$Mul".to_string(), "$Num".to_string()],
    rules: vec![
      Rule {
        callback: Box::new(|x| x[0]),
        lhs: Symbol(0),
        rhs: vec![Term::Symbol(Symbol(1))],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|x| x[0]),
        lhs: Symbol(1),
        rhs: vec![Term::Symbol(Symbol(2))],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|x| x[0] + x[2]),
        lhs: Symbol(1),
        rhs: vec![
          Term::Symbol(Symbol(1)),
          Term::Terminal("+".to_string()),
          Term::Symbol(Symbol(2)),
        ],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|x| x[0] - x[2]),
        lhs: Symbol(1),
        rhs: vec![
          Term::Symbol(Symbol(1)),
          Term::Terminal("-".to_string()),
          Term::Symbol(Symbol(2)),
        ],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|x| x[0]),
        lhs: Symbol(2),
        rhs: vec![Term::Symbol(Symbol(3))],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|x| x[0] * x[2]),
        lhs: Symbol(2),
        rhs: vec![
          Term::Symbol(Symbol(2)),
          Term::Terminal("*".to_string()),
          Term::Symbol(Symbol(3)),
        ],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|x| x[0] / x[2]),
        lhs: Symbol(2),
        rhs: vec![
          Term::Symbol(Symbol(2)),
          Term::Terminal("/".to_string()),
          Term::Symbol(Symbol(3)),
        ],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|x| x[1]),
        lhs: Symbol(3),
        rhs: vec![
          Term::Terminal("(".to_string()),
          Term::Symbol(Symbol(1)),
          Term::Terminal(")".to_string()),
        ],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 0),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("0".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 1),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("1".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 2),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("2".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 3),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("3".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 4),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("4".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 5),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("5".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 6),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("6".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 7),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("7".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 8),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("8".to_string())],
        score: 0.0,
      },
      Rule {
        callback: Box::new(|_| 9),
        lhs: Symbol(3),
        rhs: vec![Term::Terminal("0".to_string())],
        score: 0.0,
      },
    ],
    start: Symbol(0),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  #[test]
  fn parsing_test() {
    let grammar = make_grammar();
    assert_eq!(parse(&grammar, "(1+2)*3-4+5*6"), Some(35));
  }

  #[bench]
  fn parsing_benchmark(b: &mut Bencher) {
    let grammar = make_grammar();
    b.iter(|| parse(&grammar, "(1+2)*3-4+5*6"));
  }
}
