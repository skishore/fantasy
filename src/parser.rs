use rustc_hash::FxHashMap;
use std::collections::HashMap;

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

// An Arena allows us to store objects of type T in a pre-allocated block
// of memory, which faster than allocating individual members separately.
// If T is Copy, then we can also clean up by de-allocating the block,
// without running individual destructors. Pointers to objects in an Arena
// last until the Arena is de-allocated.

struct Arena<T> {
  current: Vec<T>,
  rest: Vec<Vec<T>>,
}

impl<T> Arena<T> {
  pub fn new() -> Self {
    Self::with_capacity(4096 / std::mem::size_of::<T>())
  }

  pub fn with_capacity(n: usize) -> Self {
    Self { current: Vec::with_capacity(n), rest: vec![] }
  }

  pub fn alloc(&mut self, value: T) -> &mut T {
    let capacity = self.current.capacity();
    if self.current.len() == capacity {
      let mut next = Vec::with_capacity(std::cmp::max(2 * capacity, 1));
      std::mem::swap(&mut next, &mut self.current);
      self.rest.push(next);
    }
    let len = self.current.len();
    assert!(len < self.current.capacity());
    self.current.push(value);
    &mut self.current[len]
  }
}

// A State is a rule accompanied with a "cursor" and a "start", where the
// cursor is the position in the rule up to which we have a match and the
// start is the token from which this match started.
//
// In addition, each state is part of two linked-lists:
//
//   candidate: Prior to scoring the state, this field is the head of a list
//              of candidate derivations for this state. Each candidate has
//              tracks three fields: "next", the next candidate derivation,
//              "prev", the previous state for this derivation, and "down",
//              the derivation of the term before this state's cursor.
//              Post scoring, candidate will be the winning derivation.
//
//   next: This link links to other states with the that predict the same
//         next symbol as this one. (That is, their end index and next
//         terms must match this state's.)

#[derive(Clone)]
struct Candidate<'a, T: Clone> {
  down: *const u8,
  next: *const Candidate<'a, T>,
  prev: *const State<'a, T>,
}

enum Next<'a, T: Clone> {
  Leaf(&'a Match<T>),
  Node(&'a State<'a, T>),
}

#[derive(Clone)]
struct State<'a, T: Clone> {
  candidate: *const Candidate<'a, T>,
  cursor: u16,
  next: *const State<'a, T>,
  rule: &'a IndexedRule<'a, T>,
  score: f32,
  start: u16,
}

impl<'a, T: Clone> Copy for Candidate<'a, T> {}
impl<'a, T: Clone> Copy for State<'a, T> {}

impl<'a, T: Clone> State<'a, T> {
  fn new(cursor: usize, rule: &'a IndexedRule<'a, T>, start: usize) -> Self {
    let max = u16::max_value() as usize;
    assert!(cursor <= max && start <= max);
    let (cursor, start) = (cursor as u16, start as u16);
    let (candidate, next) = (std::ptr::null(), std::ptr::null());
    Self { candidate, cursor, next, rule, score: std::f32::NEG_INFINITY, start }
  }

  fn cursor(&self) -> usize {
    self.cursor as usize
  }

  fn down(&self, down: *const u8) -> Next<'a, T> {
    assert!(self.cursor > 0);
    match self.rule.rhs[self.cursor() - 1] {
      Term::Symbol(_) => Next::Node(unsafe { &*(down as *const Self) }),
      Term::Terminal(_) => Next::Leaf(unsafe { &*(down as *const Match<T>) }),
    }
  }

  fn evaluate(&self) -> T {
    assert!(self.cursor() == self.rule.rhs.len());
    let mut xs = Vec::with_capacity(self.cursor());
    let mut current = self;
    for _ in 0..self.cursor {
      let Candidate { down, prev, .. } = unsafe { *current.candidate };
      xs.push(match current.down(down) {
        Next::Leaf(x) => x.value.clone(),
        Next::Node(x) => x.evaluate(),
      });
      current = unsafe { &*prev };
    }
    xs.reverse();
    (self.rule.callback)(&xs)
  }

  fn start(&self) -> usize {
    self.start as usize
  }
}

// A Chart is a set of Earley parser states with various links to each other.
// Candidates and states are allocated and owned by an arena. In addition,
// it includes fields with the following sizes, where N is the number of tokens,
// R is the number of rule cursor positions, and S is the number of symbols:
//
//  wanted: A hash table mapping (end, symbol) pairs to a list of states
//          ending at that token that predict that symbol to be next.
//          Maximum size: N x S.
//
// A Column has additional data structures that are used to process states
// ending at a single token index. For these structures, "end" is implicit
// in the column itself:
//
//  completed: A list of states with a start of 0 ending here.
//
//  scannable: A list of states with a cursor at a terminal ending here.
//
//  states: A list of states ending here.
//
//  lookup: A hash table mapping (start, cursor) to the unique state for
//          the triple (start, end, cursor). Maximum size: N x R.

struct Chart<'a, T: Clone> {
  grammar: &'a IndexedGrammar<'a, T>,
  candidates: Arena<Candidate<'a, T>>,
  completed: Vec<*const State<'a, T>>,
  scannable: Vec<*const State<'a, T>>,
  states: Arena<State<'a, T>>,
  wanted: FxHashMap<usize, *const State<'a, T>>,
}

struct Column<'a, T: Clone> {
  completed: Vec<*const State<'a, T>>,
  scannable: Vec<*const State<'a, T>>,
  states: Vec<*mut State<'a, T>>,
  lookup: FxHashMap<usize, *mut State<'a, T>>,
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

  fn score(&self, state: *const State<'a, T>) -> f32 {
    let state = unsafe { &mut *(state as *mut State<'a, T>) };
    if state.score > std::f32::NEG_INFINITY {
      return state.score;
    } else if state.cursor == 0 {
      state.score = state.rule.score;
      return state.score;
    }
    let mut best_candidate = std::ptr::null();
    let mut best_score = std::f32::NEG_INFINITY;
    let mut candidate = state.candidate;
    while !candidate.is_null() {
      let Candidate { down, next, prev } = unsafe { *candidate };
      let next_score = match state.down(down) {
        Next::Leaf(x) => x.score,
        Next::Node(x) => self.score(x),
      };
      let score = self.score(prev) + next_score;
      if score > best_score {
        best_candidate = candidate;
        best_score = score;
      }
      candidate = next;
    }
    assert!(!best_candidate.is_null());
    assert!(best_score > std::f32::NEG_INFINITY);
    state.candidate = best_candidate;
    state.score = best_score;
    state.score
  }

  fn step(&mut self, next: Next<'a, T>, state: *const State<'a, T>, column: &mut Column<'a, T>) {
    let state = unsafe { &*state };
    let index = state.start() * self.grammar.max_index + state.rule.index + state.cursor() + 1;
    let entry = column.lookup.entry(index).or_insert(std::ptr::null_mut());
    if entry.is_null() {
      *entry = self.states.alloc(State::new(state.cursor() + 1, state.rule, state.start()));
      column.states.push(*entry);
    }
    let down = match next {
      Next::Leaf(x) => x as *const Match<T> as *const u8,
      Next::Node(x) => x as *const State<T> as *const u8,
    };
    let next = unsafe { (**entry).candidate };
    let candidate = self.candidates.alloc(Candidate { down, next, prev: state });
    unsafe { (**entry).candidate = candidate };
  }

  fn update(&mut self, index: usize, token: Option<&'a Token<T>>) {
    let lookup = FxHashMap::default();
    let mut nullable = FxHashMap::default();
    let mut column = Column { completed: vec![], scannable: vec![], states: vec![], lookup };

    if index == 0 {
      for rule in &self.grammar.by_name[self.grammar.start.0] {
        column.states.push(self.states.alloc(State::new(0, rule, index)));
      }
    } else if let Some(token) = token {
      let mut scannable = vec![];
      std::mem::swap(&mut scannable, &mut self.scannable);
      scannable.iter().for_each(|x| {
        let state = unsafe { &**x };
        if let Term::Terminal(t) = &state.rule.rhs[state.cursor()] {
          if let Some(m) = token.matches.get(t) {
            self.step(Next::Leaf(m), state, &mut column);
          }
        }
      });
    }

    let mut i = 0;
    while i < column.states.len() {
      let state = unsafe { &*column.states[i] };
      let state_mutable = unsafe { &mut *column.states[i] };
      i += 1;
      if state.cursor() == state.rule.rhs.len() {
        let j = state.start() * self.grammar.max_index + state.rule.lhs.0;
        let mut current = self.wanted.get(&j).cloned().unwrap_or(std::ptr::null());
        while !current.is_null() {
          self.step(Next::Node(state), current, &mut column);
          current = unsafe { (*current).next };
        }
        if state.start() == 0 {
          column.completed.push(state);
        }
        if state.start() == index {
          let entry = nullable.entry(state.rule.lhs.0).or_insert(state);
          if entry.rule.score < state.rule.score {
            *entry = state;
          }
        }
      } else {
        match state.rule.rhs[state.cursor()] {
          Term::Symbol(lhs) => {
            if let Some(nullable) = nullable.get(&lhs.0) {
              self.step(Next::Node(*nullable), state, &mut column);
            }
            let j = index * self.grammar.max_index + lhs.0;
            let entry = self.wanted.entry(j).or_insert(std::ptr::null());
            if entry.is_null() {
              for rule in &self.grammar.by_name[lhs.0] {
                column.states.push(self.states.alloc(State::new(0, rule, index)));
              }
            }
            state_mutable.next = *entry;
            *entry = state;
          }
          Term::Terminal(_) => column.scannable.push(state),
        }
      }
    }

    column.states.iter().for_each(|x| {
      self.score(*x);
    });
    std::mem::swap(&mut column.completed, &mut self.completed);
    std::mem::swap(&mut column.scannable, &mut self.scannable);
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
    assert_eq!(
      (
        std::mem::size_of::<Candidate<u32>>(),
        std::mem::size_of::<Next<u32>>(),
        std::mem::size_of::<State<u32>>(),
      ),
      (24, 16, 32)
    );
  }

  #[bench]
  fn parsing_benchmark(b: &mut Bencher) {
    let grammar = make_grammar();
    assert_eq!(parse(&grammar, "(1+2)*3-4+5*6"), Some(35));
    b.iter(|| parse(&grammar, "(1+2)*3-4+5*6"));
  }
}
