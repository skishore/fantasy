use arena::Arena;
use grammar::{Child, Derivation, Grammar, Match, Rule, Semantics, Term, Token};
use rustc_hash::FxHashMap;

// A State is a rule along with a "cursor" and a "start", where the cursor is
// the position in the rule up to which we have a match and the start is the
// token from which this match started. States implicitly have an "end", too,
// which is reflected by their location in other data structures.
//
// In addition, each state is part of two linked-lists:
//
//   candidate: Prior to scoring the state, this field is the head of a list of
//              candidate derivations for this state. Each candidate has three
//              fields: "next", the next candidate, "prev", the previous state
//              for this derivation, and "down", the derivation of the term
//              before this state's cursor. Post scoring, the head of this list
//              will be the winning derivation.
//
//   next: This field lists other states that predict the same next symbol as
//         this one. (Their end index and next term must match this state's.)

#[derive(Clone)]
struct Candidate<'a, 'b, T: Clone> {
  down: *const u8,
  next: *const Candidate<'a, 'b, T>,
  prev: *const State<'a, 'b, T>,
}

enum Next<'a, 'b, T: Clone> {
  Leaf(&'b Match<'a, T>),
  Node(&'b State<'a, 'b, T>),
}

#[derive(Clone)]
struct State<'a, 'b, T: Clone> {
  candidate: *const Candidate<'a, 'b, T>,
  cursor: u16,
  next: *const State<'a, 'b, T>,
  rule: &'b IndexedRule<'a, T>,
  score: f32,
  start: u16,
}

impl<'a, 'b, T: Clone> Copy for Candidate<'a, 'b, T> {}
impl<'a, 'b, T: Clone> Copy for State<'a, 'b, T> {}

impl<'a, 'b, T: Clone> State<'a, 'b, T> {
  fn new(cursor: usize, rule: &'b IndexedRule<'a, T>, start: usize) -> Self {
    let max = u16::max_value() as usize;
    assert!(cursor <= max && start <= max);
    let (cursor, start) = (cursor as u16, start as u16);
    let (candidate, next) = (std::ptr::null(), std::ptr::null());
    Self { candidate, cursor, next, rule, score: std::f32::NEG_INFINITY, start }
  }

  fn cursor(&self) -> usize {
    self.cursor as usize
  }

  fn down(&self, down: *const u8) -> Next<'a, 'b, T> {
    assert!(self.cursor > 0);
    match self.rule.rhs[self.cursor() - 1] {
      Term::Symbol(_) => Next::Node(unsafe { &*(down as *const Self) }),
      Term::Terminal(_) => Next::Leaf(unsafe { &*(down as *const Match<T>) }),
    }
  }

  fn evaluate<S: Clone>(&self) -> Derivation<'a, S, T> {
    assert!(self.cursor() == self.rule.rhs.len());
    let mut children = Vec::with_capacity(self.cursor());
    let mut current = self;
    for _ in 0..self.cursor {
      let Candidate { down, prev, .. } = unsafe { *current.candidate };
      children.push(match current.down(down) {
        Next::Leaf(x) => Child::Leaf((*x).clone()),
        Next::Node(x) => Child::Node(x.evaluate()),
      });
      current = unsafe { &*prev };
    }
    children.reverse();
    let value = {
      let values = children.iter().map(|x| match x {
        Child::Leaf(x) => x.value.clone(),
        Child::Node(x) => x.value.clone(),
      });
      let values: Vec<_> = values.collect();
      (self.rule.callback)(&values)
    };
    let rule = unsafe { std::mem::transmute(self.rule.rule) };
    Derivation { children, rule, value }
  }

  fn start(&self) -> usize {
    self.start as usize
  }
}

// A Chart is a set of Earley parser states and candidate derivation lists,
// stored in an arena during the parse. It also includes a "wanted" hashmap:
// (Here, C = number of cursors, N = number of tokens, S = number of symbols.)
//
//  wanted: A table mapping (end, symbol) pairs to a list of states ending at
//          that token that predict that symbol next. Maximum size: N x S.
//
// A Chart also tracks a Column, which stores additional data structures that
// index states that all have the same implicit "end" index:
//
//  completed: A list of states with a start of 0 ending here.
//
//  scannable: A list of states with a cursor at a terminal ending here.
//
//  states: A list of states ending here.
//
//  lookup: A table mapping (start, cursor) to the unique state for that
//          triple's (start, end, cursor) coordinates. Maximum size: N x R.
//
//  nullable: A table mapping symbols to null derivations for those symbols
//            at the end index. (A null derivation uses no input tokens.)

struct Chart<'a, 'b, T: Clone> {
  candidates: Arena<Candidate<'a, 'b, T>>,
  column: Column<'a, 'b, T>,
  grammar: &'b IndexedGrammar<'a, T>,
  options: &'b Options,
  skipped: Option<Skipped<'a, 'b, T>>,
  states: Arena<State<'a, 'b, T>>,
  wanted: FxHashMap<usize, *const State<'a, 'b, T>>,
}

struct Column<'a, 'b, T: Clone> {
  completed: Vec<*const State<'a, 'b, T>>,
  scannable: Vec<*const State<'a, 'b, T>>,
  states: Vec<*mut State<'a, 'b, T>>,
  lookup: FxHashMap<usize, *mut State<'a, 'b, T>>,
  nullable: FxHashMap<usize, *const State<'a, 'b, T>>,
  token: Option<&'b Token<'a, T>>,
  token_index: usize,
}

impl<'a, 'b, T: Clone> Chart<'a, 'b, T> {
  fn new(grammar: &'b IndexedGrammar<'a, T>, options: &'a Options) -> Self {
    let (arena, lists) = (256, 64);
    let column = Column {
      completed: Vec::with_capacity(lists),
      scannable: Vec::with_capacity(lists),
      states: Vec::with_capacity(lists),
      lookup: FxHashMap::default(),
      nullable: FxHashMap::default(),
      token: None,
      token_index: 0,
    };
    let (candidates, states) = (Arena::with_capacity(arena), Arena::with_capacity(arena));
    let skipped = if options.skip_count > 0 { Some(Skipped::new(options)) } else { None };
    let wanted = FxHashMap::default();
    let mut result = Self { candidates, column, grammar, options, skipped, states, wanted };
    for rule in &result.grammar.by_name[grammar.start] {
      result.column.states.push(result.states.alloc(State::new(0, rule, 0)));
    }
    result.fill_column();
    result
  }

  fn advance_state(&mut self, next: Next<'a, 'b, T>, state: *const State<'a, 'b, T>) {
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

  fn get_result<S: Clone>(mut self) -> Option<Derivation<'a, S, T>> {
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

  fn process_token(&mut self, token: &'b Token<'a, T>) {
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
        if let Some(m) = token.matches.get(t.as_str()) {
          self.advance_state(Next::Leaf(m), state);
        }
      }
    });

    self.fill_column();
  }

  fn score_state(&self, state: *const State<'a, 'b, T>) -> f32 {
    let state = unsafe { &mut *(state as *mut State<'a, 'b, T>) };
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

// A Skipped structure keeps a small rolling window of past column's states.
// We use it to support parsing that ignores some tokens at a given penalty.

type States<'a, 'b, T> = Vec<*const State<'a, 'b, T>>;

struct Skipped<'a, 'b, T: Clone> {
  completed: Vec<States<'a, 'b, T>>,
  scannable: Vec<States<'a, 'b, T>>,
  ring_last: usize,
  ring_size: usize,
  skip_penalty: f32,
}

impl<'a, 'b, T: Clone> Skipped<'a, 'b, T> {
  fn new(options: &'a Options) -> Self {
    let Options { skip_count: n, skip_penalty, .. } = *options;
    let completed = (0..=n).map(|_| vec![]).collect();
    let scannable = (0..=n).map(|_| vec![]).collect();
    Self { completed, scannable, ring_last: n, ring_size: n + 1, skip_penalty }
  }

  fn penalize(
    &self,
    arena: &mut Arena<State<'a, 'b, T>>,
    columns: &[States<'a, 'b, T>],
  ) -> States<'a, 'b, T> {
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

  fn push_column(&mut self, column: &mut Column<'a, 'b, T>) {
    self.ring_last = (self.ring_last + 1) % self.ring_size;
    std::mem::swap(&mut self.completed[self.ring_last], &mut column.completed);
    std::mem::swap(&mut self.scannable[self.ring_last], &mut column.scannable);
  }

  fn get_completed(&mut self, arena: &mut Arena<State<'a, 'b, T>>) -> States<'a, 'b, T> {
    self.penalize(arena, self.completed.as_ref())
  }

  fn get_scannable(&mut self, arena: &mut Arena<State<'a, 'b, T>>) -> States<'a, 'b, T> {
    self.penalize(arena, self.scannable.as_ref())
  }
}

// An IndexedGrammar is a parsing-only grammar that includes an extra "index"
// field on each rule, which is the cursor position at the start of that rule.

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
  rule: &'a Rule<(), T>,
  score: f32,
}

fn index<S: Clone, T: Clone>(grammar: &Grammar<S, T>) -> IndexedGrammar<T> {
  let mut index = 0;
  let mut by_name: Vec<_> = grammar.names.iter().map(|_| vec![]).collect();
  for rule in grammar.rules.iter().filter(|x| x.merge.score > std::f32::NEG_INFINITY) {
    let Rule { lhs, rhs, merge: Semantics { callback, score }, .. } = rule;
    let (callback, lhs, rhs, score) = (&**callback, *lhs, &rhs, *score);
    let rule = unsafe { std::mem::transmute(rule) };
    let indexed = IndexedRule { callback, index, lhs, rhs, rule, score };
    by_name[rule.lhs].push(indexed);
    index += rule.rhs.len() + 1;
  }
  IndexedGrammar { by_name, max_index: index, names: &grammar.names, start: grammar.start }
}

// Our public interface: a simple call to parse an input and get an Option<T>,
// along with a few parsing options. We may want to make index public later.

pub struct Options {
  debug: bool,
  skip_count: usize,
  skip_penalty: f32,
}

impl Options {
  pub fn new() -> Self {
    Self { debug: false, skip_count: 0, skip_penalty: 0.0 }
  }

  pub fn debug(mut self) -> Self {
    self.debug = true;
    self
  }

  pub fn skip_count(mut self, skip_count: usize) -> Self {
    self.skip_count = skip_count;
    self
  }

  pub fn skip_penalty(mut self, skip_penalty: f32) -> Self {
    self.skip_penalty = skip_penalty;
    self
  }
}

pub fn parse<'a, 'b: 'a, S: Clone, T: Clone>(
  grammar: &'b Grammar<S, T>,
  input: &'b str,
  options: &'b Options,
) -> Option<Derivation<'a, S, T>> {
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
  use grammar::{Lexer, RuleData, Tense, TermData};
  use std::marker::PhantomData;
  use test::Bencher;

  #[derive(Default)]
  struct CharacterLexer<T: Clone + Default> {
    data: TermData,
    mark: PhantomData<T>,
  }

  impl<T: Clone + Default> Lexer<(), T> for CharacterLexer<T> {
    fn fix<'a, 'b: 'a>(&'b self, _: &'a Match<'a, T>, _: &'a Tense) -> Vec<Match<'a, T>> {
      unimplemented!()
    }

    fn lex<'a, 'b: 'a>(&'b self, input: &'b str) -> Vec<Token<'a, T>> {
      let map = input.char_indices().map(|(i, x)| {
        let text = &input[i..i + x.len_utf8()];
        let base = Match { data: &self.data, score: 0.0, value: T::default() };
        let mut matches = FxHashMap::default();
        matches.insert(text, base.clone());
        matches.insert("%ch", base.clone());
        Token { matches, text }
      });
      map.collect()
    }

    fn unlex(&self, _: ()) -> Vec<Match<T>> {
      unimplemented!()
    }
  }

  fn make_rule<F: Fn(&[T]) -> T + 'static, T: Clone>(lhs: usize, rhs: &str, f: F) -> Rule<(), T> {
    make_rule_with_score(lhs, rhs, f, 0.0)
  }

  fn make_rule_with_score<F: Fn(&[T]) -> T + 'static, T: Clone>(
    lhs: usize,
    rhs: &str,
    f: F,
    score: f32,
  ) -> Rule<(), T> {
    let merge: Semantics<Fn(&[T]) -> T> = Semantics { callback: Box::new(f), score };
    let split: Semantics<Fn(()) -> Vec<Vec<()>>> =
      Semantics { callback: Box::new(|_| unimplemented!()), score: 0.0 };
    let rhs = rhs.split(' ').filter(|x| !x.is_empty()).map(make_term).collect();
    Rule { data: RuleData::default(), lhs, rhs, merge, split }
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

  pub fn value<'a, 'b: 'a, S: Clone, T: Clone>(
    grammar: &'b Grammar<S, T>,
    input: &'b str,
    options: &'b Options,
  ) -> Option<T> {
    parse(grammar, input, options).map(|x| x.value.clone())
  }

  #[test]
  fn scoring_works() {
    let grammar = Grammar {
      lexer: Box::new(CharacterLexer::default()),
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
    assert_eq!(value(&grammar, "aaa", &options), Some("aaa".to_string()));
    assert_eq!(value(&grammar, "aab", &options), Some("aa".to_string()));
    assert_eq!(value(&grammar, "abb", &options), Some("bb".to_string()));
    assert_eq!(value(&grammar, "bab", &options), Some("bb".to_string()));
    assert_eq!(value(&grammar, "b?b", &options), Some("bb".to_string()));
    assert_eq!(value(&grammar, "b??", &options), Some("".to_string()));
  }

  #[test]
  fn skipping_works() {
    let grammar = Grammar {
      lexer: Box::new(CharacterLexer::default()),
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
    assert_eq!(value(&grammar, "1+2+3   ", &skip(0)), Some(6));
    assert_eq!(value(&grammar, "1+2?+3  ", &skip(0)), None);
    assert_eq!(value(&grammar, "1+2+3  ?", &skip(0)), None);
    assert_eq!(value(&grammar, "1+2?+3 ?", &skip(1)), Some(6));
    assert_eq!(value(&grammar, "1+2?+3  ", &skip(1)), Some(6));
    assert_eq!(value(&grammar, "1+2+3  ?", &skip(1)), Some(6));
    assert_eq!(value(&grammar, "1+2?+3 ?", &skip(1)), Some(6));
    assert_eq!(value(&grammar, "1+2??+3 ", &skip(1)), None);
    assert_eq!(value(&grammar, "1+2+3 ??", &skip(1)), None);
    assert_eq!(value(&grammar, "1+2??+3 ", &skip(2)), Some(6));
    assert_eq!(value(&grammar, "1+2+3 ??", &skip(2)), Some(6));
  }

  #[bench]
  fn parsing_benchmark(b: &mut Bencher) {
    let grammar = Grammar {
      lexer: Box::new(CharacterLexer::default()),
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
    assert_eq!(value(&grammar, "(1+2)*3-4+5*6", &options), Some(35));
    assert_eq!(value(&grammar, "1+2*(3-4)+5*6", &options), Some(29));
    assert_eq!(value(&grammar, "1+2*3-4)+5*(6", &options), None);
    b.iter(|| value(&grammar, "(1+2)*3-4+5*6", &options));
  }
}
