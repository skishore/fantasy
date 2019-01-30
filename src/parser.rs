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
  start: usize,
}

pub struct Rule<T: Clone> {
  callback: Box<Fn(&[T]) -> T>,
  lhs: usize,
  rhs: Vec<Term>,
  score: f32,
}

pub enum Term {
  Symbol(usize),
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
  candidates: Arena<Candidate<'a, T>>,
  column: Column<'a, T>,
  grammar: &'a IndexedGrammar<'a, T>,
  options: &'a Options,
  skipped: Option<Skipped<'a, T>>,
  states: Arena<State<'a, T>>,
  wanted: FxHashMap<usize, *const State<'a, T>>,
}

struct Column<'a, T: Clone> {
  completed: Vec<*const State<'a, T>>,
  scannable: Vec<*const State<'a, T>>,
  states: Vec<*mut State<'a, T>>,
  lookup: FxHashMap<usize, *mut State<'a, T>>,
  nullable: FxHashMap<usize, *const State<'a, T>>,
  token: Option<&'a Token<T>>,
  token_index: usize,
}

impl<'a, T: Clone> Chart<'a, T> {
  fn new(grammar: &'a IndexedGrammar<T>, options: &'a Options) -> Self {
    let capacity = 64;
    let column = Column {
      completed: Vec::with_capacity(capacity),
      scannable: Vec::with_capacity(capacity),
      states: Vec::with_capacity(capacity),
      lookup: FxHashMap::default(),
      nullable: FxHashMap::default(),
      token: None,
      token_index: 0,
    };
    let (candidates, states) = (Arena::new(), Arena::new());
    let skipped = if options.skip_count > 0 { Some(Skipped::new(options)) } else { None };
    let wanted = FxHashMap::default();
    let mut result = Self { candidates, column, grammar, options, skipped, states, wanted };
    for rule in &result.grammar.by_name[grammar.start] {
      result.column.states.push(result.states.alloc(State::new(0, rule, 0)));
    }
    result.fill_column();
    result
  }

  fn advance_state(&mut self, next: Next<'a, T>, state: *const State<'a, T>) {
    let state = unsafe { &*state };
    let index = state.start() * self.grammar.max_index + state.rule.index + state.cursor() + 1;
    let entry = self.column.lookup.entry(index).or_insert(std::ptr::null_mut());
    if entry.is_null() {
      *entry = self.states.alloc(State::new(state.cursor() + 1, state.rule, state.start()));
      self.column.states.push(*entry);
    }
    let down = match next {
      Next::Leaf(x) => x as *const Match<T> as *const u8,
      Next::Node(x) => x as *const State<T> as *const u8,
    };
    let next = unsafe { (**entry).candidate };
    let candidate = self.candidates.alloc(Candidate { down, next, prev: state });
    unsafe { (**entry).candidate = candidate };
  }

  fn fill_column(&mut self) {
    let mut i = 0;
    let index = self.column.token_index;

    while i < self.column.states.len() {
      let state = unsafe { &*self.column.states[i] };
      let state_mutable = unsafe { &mut *self.column.states[i] };
      i += 1;
      if state.cursor() == state.rule.rhs.len() {
        let j = state.start() * self.grammar.max_index + state.rule.lhs;
        let mut current = self.wanted.get(&j).cloned().unwrap_or(std::ptr::null());
        while !current.is_null() {
          self.advance_state(Next::Node(state), current);
          current = unsafe { (*current).next };
        }
        if state.start() == 0 {
          self.column.completed.push(state);
        }
        if state.start() == index {
          let entry = self.column.nullable.entry(state.rule.lhs).or_insert(state);
          if unsafe { **entry }.rule.score < state.rule.score {
            *entry = state;
          }
        }
      } else {
        match state.rule.rhs[state.cursor()] {
          Term::Symbol(lhs) => {
            let nullable = self.column.nullable.get(&lhs).cloned().unwrap_or(std::ptr::null());
            if !nullable.is_null() {
              self.advance_state(Next::Node(unsafe { &*nullable }), state);
            }
            let j = index * self.grammar.max_index + lhs;
            let entry = self.wanted.entry(j).or_insert(std::ptr::null());
            if entry.is_null() {
              for rule in &self.grammar.by_name[lhs] {
                self.column.states.push(self.states.alloc(State::new(0, rule, index)));
              }
            }
            state_mutable.next = *entry;
            *entry = state;
          }
          Term::Terminal(_) => self.column.scannable.push(state),
        }
      }
    }

    self.column.states.iter().for_each(|x| {
      self.score_state(*x);
    });
    if self.options.debug {
      println!("{}", self.print_column());
    }
  }

  fn get_result(mut self) -> Option<T> {
    let mut _temp = None;
    let completed = if let Some(skipped) = self.skipped.as_mut() {
      skipped.push_column(&mut self.column);
      let completed = skipped.get_completed(&mut self.states);
      _temp = Some(completed);
      _temp.as_ref().unwrap()
    } else {
      &self.column.completed
    };
    let mut best_score = std::f32::NEG_INFINITY;
    let mut best_state = None;
    for state in completed {
      let state = unsafe { &**state };
      if state.rule.lhs == self.grammar.start && state.score > best_score {
        best_score = state.score;
        best_state = Some(state);
      }
    }
    best_state.map(|x| x.evaluate())
  }

  fn print_column(&self) -> String {
    let header = self.column.token.map(|x| {
      let mut xs: Vec<_> = x.matches.iter().collect();
      xs.sort_by(|(a, _), (b, _)| a.cmp(b));
      let xs: Vec<_> = xs.iter().map(|(k, v)| format!("  {} (score: {})", k, v.score)).collect();
      format!(": {:?}\n{}", x.text, xs.join("\n"))
    });
    let states = self.column.states.iter().map(|x| {
      let x = unsafe { &**x };
      let lhs = self.grammar.names[x.rule.lhs].clone();
      let rhs = x.rule.rhs.iter().map(|x| match &x {
        &Term::Symbol(x) => self.grammar.names[*x].clone(),
        &Term::Terminal(x) => x.clone(),
      });
      let mut rhs = rhs.collect::<Vec<_>>();
      rhs.insert(x.cursor(), "●".to_string());
      format!("{} -> {}, from: {} (score: {})", lhs, rhs.join(" "), x.start, x.score)
    });
    let states = states.collect::<Vec<_>>().join("\n");
    format!("\nColumn {}{}\n{}", self.column.token_index, header.unwrap_or("".to_string()), states)
  }

  fn process_token(&mut self, token: &'a Token<T>) {
    let scannable = if let Some(skipped) = self.skipped.as_mut() {
      skipped.push_column(&mut self.column);
      skipped.get_scannable(&mut self.states)
    } else {
      let mut scannable = Vec::with_capacity(self.column.scannable.capacity());
      std::mem::swap(&mut scannable, &mut self.column.scannable);
      scannable
    };

    self.column.completed.clear();
    self.column.scannable.clear();
    self.column.states.clear();
    self.column.lookup.clear();
    self.column.nullable.clear();
    self.column.token = Some(token);
    self.column.token_index += 1;

    scannable.iter().for_each(|x| {
      let state = unsafe { &**x };
      if let Term::Terminal(t) = &state.rule.rhs[state.cursor()] {
        if let Some(m) = token.matches.get(t) {
          self.advance_state(Next::Leaf(m), state);
        }
      }
    });

    self.fill_column();
  }

  fn score_state(&self, state: *const State<'a, T>) -> f32 {
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
        Next::Node(x) => self.score_state(x),
      };
      let score = self.score_state(prev) + next_score;
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
}

// A Skipped structure keeps a small rolling window of past column's states
// that can be used to implement robust parsing skipping over some tokens.

type States<'a, T> = Vec<*const State<'a, T>>;

struct Skipped<'a, T: Clone> {
  completed: Vec<States<'a, T>>,
  scannable: Vec<States<'a, T>>,
  ring_last: usize,
  ring_size: usize,
  skip_penalty: f32,
}

impl<'a, T: Clone> Skipped<'a, T> {
  fn new(options: &'a Options) -> Self {
    let Options { skip_count: n, skip_penalty, .. } = *options;
    let completed = (0..=n).map(|_| vec![]).collect();
    let scannable = (0..=n).map(|_| vec![]).collect();
    Self { completed, scannable, ring_last: n, ring_size: n + 1, skip_penalty }
  }

  fn penalize(&self, arena: &mut Arena<State<'a, T>>, columns: &[States<'a, T>]) -> States<'a, T> {
    let capacity = columns.iter().fold(0, |a, x| a + x.len());
    let mut result = Vec::with_capacity(capacity);
    (0..self.ring_size).for_each(|i| {
      let j = (self.ring_last + self.ring_size - i) % self.ring_size;
      if i == 0 {
        result.extend_from_slice(&columns[j]);
      } else {
        columns[j].iter().for_each(|y| {
          let mut state = unsafe { (**y).clone() };
          state.score += i as f32 * self.skip_penalty;
          result.push(arena.alloc(state));
        });
      }
    });
    result
  }

  fn push_column(&mut self, column: &mut Column<'a, T>) {
    self.ring_last = (self.ring_last + 1) % self.ring_size;
    std::mem::swap(&mut self.completed[self.ring_last], &mut column.completed);
    std::mem::swap(&mut self.scannable[self.ring_last], &mut column.scannable);
  }

  fn get_completed(&mut self, arena: &mut Arena<State<'a, T>>) -> States<'a, T> {
    self.penalize(arena, self.completed.as_ref())
  }

  fn get_scannable(&mut self, arena: &mut Arena<State<'a, T>>) -> States<'a, T> {
    self.penalize(arena, self.scannable.as_ref())
  }
}

// A simple options builder for our parser. Most of the options have to do
// with the token-skipping support implemented above.

pub struct Options {
  debug: bool,
  skip_count: usize,
  skip_penalty: f32,
}

impl Options {
  fn new() -> Self {
    Self { debug: false, skip_count: 0, skip_penalty: 0.0 }
  }

  fn debug(mut self) -> Self {
    self.debug = true;
    self
  }

  fn skip_count(mut self, skip_count: usize) -> Self {
    self.skip_count = skip_count;
    self
  }

  fn skip_penalty(mut self, skip_penalty: f32) -> Self {
    self.skip_penalty = skip_penalty;
    self
  }
}

// An IndexedGrammar is a variant on a grammar that has a few additional
// fields for fast lookups during parsing, like a per-cursor index number.

struct IndexedGrammar<'a, T: Clone> {
  by_name: Vec<Vec<IndexedRule<'a, T>>>,
  max_index: usize,
  names: &'a [String],
  start: usize,
}

struct IndexedRule<'a, T: Clone> {
  callback: &'a Fn(&[T]) -> T,
  index: usize,
  lhs: usize,
  rhs: &'a [Term],
  score: f32,
}

fn index<T: Clone>(grammar: &Grammar<T>) -> IndexedGrammar<T> {
  let mut index = 0;
  let mut by_name: Vec<_> = grammar.names.iter().map(|_| vec![]).collect();
  for rule in grammar.rules.iter().filter(|x| x.score > std::f32::NEG_INFINITY) {
    let Rule { callback, lhs, rhs, score } = rule;
    let indexed = IndexedRule { callback: &**callback, index, lhs: *lhs, rhs: &rhs, score: *score };
    by_name[rule.lhs].push(indexed);
    index += rule.rhs.len() + 1;
  }
  IndexedGrammar { by_name, max_index: index, names: &grammar.names, start: grammar.start }
}

pub fn parse<T: Clone>(grammar: &Grammar<T>, input: &str, options: &Options) -> Option<T> {
  let indexed = index(grammar);
  let tokens = grammar.lexer.lex(input);
  let mut chart = Chart::new(&indexed, options);
  for token in tokens.iter() {
    chart.process_token(token);
  }
  chart.get_result()
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::marker::PhantomData;
  use test::Bencher;

  struct CharacterLexer<T: Clone + Default> {
    mark: PhantomData<T>,
  }

  impl<T: Clone + Default> Lexer<T> for CharacterLexer<T> {
    fn lex(&self, input: &str) -> Vec<Token<T>> {
      let map = input.chars().map(|x| {
        let mut matches = HashMap::new();
        matches.insert(x.to_string(), Match { score: 0.0, value: T::default() });
        matches.insert("%ch".to_string(), Match { score: 0.0, value: T::default() });
        Token { matches, text: x.to_string() }
      });
      map.collect()
    }
  }

  fn make_rule<F: Fn(&[T]) -> T + 'static, T: Clone>(lhs: usize, rhs: &str, f: F) -> Rule<T> {
    make_rule_with_score(lhs, rhs, f, 0.0)
  }

  fn make_rule_with_score<F: Fn(&[T]) -> T + 'static, T: Clone>(
    lhs: usize,
    rhs: &str,
    f: F,
    score: f32,
  ) -> Rule<T> {
    let rhs = rhs.split(' ').filter(|x| !x.is_empty()).map(make_term).collect();
    Rule { callback: Box::new(f), lhs, rhs, score }
  }

  fn make_term(term: &str) -> Term {
    if term.starts_with("$") {
      Term::Symbol(term[1..].parse().unwrap())
    } else if term == "%ws" {
      Term::Terminal(" ".to_string())
    } else {
      Term::Terminal(term.to_string())
    }
  }

  #[test]
  fn scoring_works() {
    let grammar = Grammar {
      lexer: Box::new(CharacterLexer { mark: PhantomData }),
      names: "$Root $As $Bs $Neither $A $B".split(' ').map(|x| x.to_string()).collect(),
      rules: vec![
        make_rule_with_score(0, "$1", |x| x.join(""), 0.0),
        make_rule_with_score(0, "$2", |x| x.join(""), 0.0),
        make_rule_with_score(0, "$3", |x| x.join(""), 0.0),
        make_rule_with_score(1, "$1 $4", |x| x.join(""), 0.0),
        make_rule_with_score(1, "", |x| x.join(""), 0.0),
        make_rule_with_score(4, "a", |_| "a".to_string(), 1.0),
        make_rule_with_score(4, "%ch", |x| x.join(""), -1.0),
        make_rule_with_score(2, "$2 $5", |x| x.join(""), 0.0),
        make_rule_with_score(2, "", |x| x.join(""), 0.0),
        make_rule_with_score(5, "b", |_| "b".to_string(), 1.0),
        make_rule_with_score(5, "%ch", |x| x.join(""), -1.0),
        make_rule_with_score(3, "$3 %ch", |x| x.join(""), 0.0),
        make_rule_with_score(3, "", |x| x.join(""), 0.0),
      ],
      start: 0,
    };
    let options = Options::new();
    assert_eq!(parse(&grammar, "aaa", &options), Some("aaa".to_string()));
    assert_eq!(parse(&grammar, "aab", &options), Some("aa".to_string()));
    assert_eq!(parse(&grammar, "abb", &options), Some("bb".to_string()));
    assert_eq!(parse(&grammar, "bab", &options), Some("bb".to_string()));
    assert_eq!(parse(&grammar, "b?b", &options), Some("bb".to_string()));
    assert_eq!(parse(&grammar, "b??", &options), Some("".to_string()));
  }

  #[test]
  fn skipping_works() {
    let grammar = Grammar {
      lexer: Box::new(CharacterLexer { mark: PhantomData }),
      names: "$Root $Add $Num $Whitespace".split(' ').map(|x| x.to_string()).collect(),
      rules: vec![
        make_rule(0, "$1 $3", |x| x[0]),
        make_rule(1, "$2", |x| x[0]),
        make_rule(1, "$1 + $2", |x| x[0] + x[2]),
        make_rule(2, "1", |_| 1),
        make_rule(2, "2", |_| 2),
        make_rule(2, "3", |_| 3),
        make_rule(3, "$3 %ws", |_| 0),
        make_rule(3, "", |_| 0),
      ],
      start: 0,
    };
    let skip = |x| Options::new().skip_count(x).skip_penalty(-1.0);
    assert_eq!(parse(&grammar, "1+2+3   ", &skip(0)), Some(6));
    assert_eq!(parse(&grammar, "1+2?+3  ", &skip(0)), None);
    assert_eq!(parse(&grammar, "1+2+3  ?", &skip(0)), None);
    assert_eq!(parse(&grammar, "1+2?+3 ?", &skip(1)), Some(6));
    assert_eq!(parse(&grammar, "1+2?+3  ", &skip(1)), Some(6));
    assert_eq!(parse(&grammar, "1+2+3  ?", &skip(1)), Some(6));
    assert_eq!(parse(&grammar, "1+2?+3 ?", &skip(1)), Some(6));
    assert_eq!(parse(&grammar, "1+2??+3 ", &skip(1)), None);
    assert_eq!(parse(&grammar, "1+2+3 ??", &skip(1)), None);
    assert_eq!(parse(&grammar, "1+2??+3 ", &skip(2)), Some(6));
    assert_eq!(parse(&grammar, "1+2+3 ??", &skip(2)), Some(6));
  }

  #[bench]
  fn parsing_benchmark(b: &mut Bencher) {
    let grammar = Grammar {
      lexer: Box::new(CharacterLexer { mark: PhantomData }),
      names: "$Root $Add $Mul $Num".split(' ').map(|x| x.to_string()).collect(),
      rules: vec![
        make_rule(0, "$1", |x| x[0]),
        make_rule(1, "$2", |x| x[0]),
        make_rule(1, "$1 + $2", |x| x[0] + x[2]),
        make_rule(1, "$1 - $2", |x| x[0] - x[2]),
        make_rule(2, "$3", |x| x[0]),
        make_rule(2, "$2 * $3", |x| x[0] * x[2]),
        make_rule(2, "$2 / $3", |x| x[0] / x[2]),
        make_rule(3, "( $1 )", |x| x[1]),
        make_rule(3, "0", |_| 0),
        make_rule(3, "1", |_| 1),
        make_rule(3, "2", |_| 2),
        make_rule(3, "3", |_| 3),
        make_rule(3, "4", |_| 4),
        make_rule(3, "5", |_| 5),
        make_rule(3, "6", |_| 6),
        make_rule(3, "7", |_| 7),
        make_rule(3, "8", |_| 8),
        make_rule(3, "9", |_| 9),
      ],
      start: 0,
    };
    let options = Options::new();
    assert_eq!(parse(&grammar, "(1+2)*3-4+5*6", &options), Some(35));
    assert_eq!(parse(&grammar, "1+2*(3-4)+5*6", &options), Some(29));
    assert_eq!(parse(&grammar, "1+2*3-4)+5*(6", &options), None);
    b.iter(|| parse(&grammar, "(1+2)*3-4+5*6", &options));
  }
}
