use arena::Arena;
use base::{Child, Derivation, Entry, Grammar, Rule, Term, Token};
use rustc_hash::FxHashMap;
use std::rc::Rc;

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

struct Candidate<'a, 'b, T> {
  down: *const u8,
  next: *const Candidate<'a, 'b, T>,
  prev: *const State<'a, 'b, T>,
}

enum Down<'a, 'b, T> {
  Leaf(&'a Entry<T>),
  Node(&'a State<'a, 'b, T>),
}

struct State<'a, 'b, T> {
  candidate: *const Candidate<'a, 'b, T>,
  cursor: u16,
  next: *const State<'a, 'b, T>,
  rule: &'a IndexedRule<'b, T>,
  score: f32,
  start: u16,
}

impl<'a, 'b, T> State<'a, 'b, T> {
  fn new(cursor: usize, rule: &'a IndexedRule<'b, T>, start: usize) -> Self {
    let max = u16::max_value() as usize;
    assert!(cursor <= max && start <= max);
    let (cursor, start) = (cursor as u16, start as u16);
    let (candidate, next) = (std::ptr::null(), std::ptr::null());
    Self { candidate, cursor, next, rule, score: std::f32::NEG_INFINITY, start }
  }

  fn cursor(&self) -> usize {
    self.cursor as usize
  }

  fn down(&self, down: *const u8) -> Down<'a, 'b, T> {
    assert!(self.cursor > 0);
    match self.rule.base.rhs[self.cursor() - 1] {
      Term::Symbol(_) => Down::Node(unsafe { &*(down as *const Self) }),
      Term::Terminal(_) => Down::Leaf(unsafe { &*(down as *const Entry<T>) }),
    }
  }

  fn evaluate<S>(&self) -> Derivation<'b, S, T> {
    assert!(self.cursor() == self.rule.base.rhs.len());
    let mut children = Vec::with_capacity(self.cursor());
    let mut current = self;
    for _ in 0..self.cursor {
      let Candidate { down, prev, .. } = unsafe { &*current.candidate };
      children.push(match current.down(*down) {
        Down::Leaf(x) => Child::Leaf(Rc::clone(&x.1)),
        Down::Node(x) => Child::Node(Rc::new(x.evaluate())),
      });
      current = unsafe { &**prev };
    }
    children.reverse();
    let rule = unsafe { std::mem::transmute(self.rule.base) };
    Derivation::new(children, rule)
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

struct Chart<'a, 'b, T> {
  candidates: Arena<Candidate<'a, 'b, T>>,
  column: Column<'a, 'b, T>,
  debug: bool,
  grammar: &'a IndexedGrammar<'b, T>,
  skipped: Option<Skipped<'a, 'b, T>>,
  states: Arena<State<'a, 'b, T>>,
  wanted: FxHashMap<usize, *const State<'a, 'b, T>>,
}

struct Column<'a, 'b, T> {
  completed: Vec<*const State<'a, 'b, T>>,
  scannable: Vec<*const State<'a, 'b, T>>,
  states: Vec<*mut State<'a, 'b, T>>,
  lookup: FxHashMap<usize, *mut State<'a, 'b, T>>,
  nullable: FxHashMap<usize, *const State<'a, 'b, T>>,
  token: Option<&'a Token<'b, T>>,
  token_index: usize,
}

impl<'a, 'b, T> Chart<'a, 'b, T> {
  fn new<S>(grammar: &'a IndexedGrammar<'b, T>, options: &Parser<'a, S, T>) -> Self {
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
    let (debug, wanted) = (options.debug, FxHashMap::default());
    let mut result = Self { candidates, column, debug, grammar, skipped, states, wanted };
    for rule in &result.grammar.by_name[grammar.start] {
      result.column.states.push(result.states.alloc(State::new(0, rule, 0)));
    }
    result.fill_column();
    result
  }

  fn advance_state(&mut self, down: Down<'a, 'b, T>, state: *const State<'a, 'b, T>) {
    let state = unsafe { &*state };
    let index = state.start() * self.grammar.max_index + state.rule.index + state.cursor() + 1;
    let entry = self.column.lookup.entry(index).or_insert(std::ptr::null_mut());
    if entry.is_null() {
      *entry = self.states.alloc(State::new(state.cursor() + 1, state.rule, state.start()));
      self.column.states.push(*entry);
    }
    let down = match down {
      Down::Leaf(x) => x as *const Entry<T> as *const u8,
      Down::Node(x) => x as *const State<T> as *const u8,
    };
    let next = unsafe { (**entry).candidate };
    let candidate = self.candidates.alloc(Candidate { down, next, prev: state });
    unsafe { (**entry).candidate = candidate };
  }

  fn fill_column(&mut self) {
    let mut i = 0;
    let start = self.column.token_index;

    while i < self.column.states.len() {
      let state = unsafe { &*self.column.states[i] };
      let state_mutable = unsafe { &mut *self.column.states[i] };
      let rule = state.rule.base;
      i += 1;
      if state.cursor() == rule.rhs.len() {
        let j = state.start() * self.grammar.max_index + rule.lhs;
        let mut current = self.wanted.get(&j).cloned().unwrap_or(std::ptr::null());
        while !current.is_null() {
          self.advance_state(Down::Node(state), current);
          current = unsafe { (*current).next };
        }
        if state.start() == 0 {
          self.column.completed.push(state);
        }
        if state.start() == start {
          let entry = self.column.nullable.entry(rule.lhs).or_insert(state);
          if unsafe { &**entry }.rule.base.merge.score < rule.merge.score {
            *entry = state;
          }
        }
      } else {
        match rule.rhs[state.cursor()] {
          Term::Symbol(lhs) => {
            let nullable = self.column.nullable.get(&lhs).cloned().unwrap_or(std::ptr::null());
            if !nullable.is_null() {
              self.advance_state(Down::Node(unsafe { &*nullable }), state);
            }
            let j = start * self.grammar.max_index + lhs;
            let entry = self.wanted.entry(j).or_insert(std::ptr::null());
            if entry.is_null() {
              for rule in &self.grammar.by_name[lhs] {
                self.column.states.push(self.states.alloc(State::new(0, rule, start)));
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
    if self.debug {
      println!("{}", self.print_column());
    }
  }

  fn get_result<S>(mut self) -> Option<Derivation<'b, S, T>> {
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
      if state.rule.base.lhs == self.grammar.start && state.score > best_score {
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
      let xs: Vec<_> = xs.iter().map(|(k, v)| format!("  {} (score: {})", k, v.0)).collect();
      format!(": {:?}\n{}", x.text, xs.join("\n"))
    });
    let states = self.column.states.iter().map(|x| {
      let x = unsafe { &**x };
      let lhs = self.grammar.names[x.rule.base.lhs].clone();
      let rhs = x.rule.base.rhs.iter().map(|y| match y {
        Term::Symbol(z) => self.grammar.names[*z].clone(),
        Term::Terminal(z) => z.clone(),
      });
      let mut rhs = rhs.collect::<Vec<_>>();
      rhs.insert(x.cursor(), "●".to_string());
      format!("{} -> {}, from: {} (score: {})", lhs, rhs.join(" "), x.start, x.score)
    });
    let states = states.collect::<Vec<_>>().join("\n");
    format!("\nColumn {}{}\n{}", self.column.token_index, header.unwrap_or("".to_string()), states)
  }

  fn process_token(&mut self, token: &'a Token<'b, T>) {
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
      if let Term::Terminal(t) = &state.rule.base.rhs[state.cursor()] {
        if let Some(m) = token.matches.get(t.as_str()) {
          self.advance_state(Down::Leaf(m), state);
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
      state.score = state.rule.base.merge.score;
      return state.score;
    }
    let mut best_candidate = std::ptr::null();
    let mut best_score = std::f32::NEG_INFINITY;
    let mut candidate = state.candidate;
    while !candidate.is_null() {
      let Candidate { down, next, prev } = unsafe { &*candidate };
      let next_score = match state.down(*down) {
        Down::Leaf(x) => x.0,
        Down::Node(x) => self.score_state(x),
      };
      let score = self.score_state(*prev) + next_score;
      if score > best_score {
        best_candidate = candidate;
        best_score = score;
      }
      candidate = *next;
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

struct Skipped<'a, 'b, T> {
  completed: Vec<States<'a, 'b, T>>,
  scannable: Vec<States<'a, 'b, T>>,
  ring_last: usize,
  ring_size: usize,
  skip_penalty: f32,
}

impl<'a, 'b, T> Skipped<'a, 'b, T> {
  fn new<S>(options: &Parser<'a, S, T>) -> Self {
    let Parser { skip_count: n, skip_penalty, .. } = *options;
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
          let mut state = unsafe { std::ptr::read(*y) };
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

struct IndexedGrammar<'a, T> {
  by_name: Vec<Vec<IndexedRule<'a, T>>>,
  max_index: usize,
  names: &'a [String],
  start: usize,
}

struct IndexedRule<'a, T> {
  base: &'a Rule<(), T>,
  index: usize,
}

fn index<S, T>(grammar: &Grammar<S, T>) -> IndexedGrammar<T> {
  let mut index = 0;
  let mut by_name: Vec<_> = grammar.names.iter().map(|_| vec![]).collect();
  for rule in grammar.rules.iter().filter(|x| x.merge.score > std::f32::NEG_INFINITY) {
    by_name[rule.lhs].push(IndexedRule { base: unsafe { std::mem::transmute(rule) }, index });
    index += rule.rhs.len() + 1;
  }
  IndexedGrammar { by_name, max_index: index, names: &grammar.names, start: grammar.start }
}

// Our public interface: use a builder interface to set a Parser's options,
// then call parse(). We may want to make index() public later for performance.

pub struct Parser<'a, S, T> {
  debug: bool,
  grammar: &'a Grammar<S, T>,
  indexed: IndexedGrammar<'a, T>,
  skip_count: usize,
  skip_penalty: f32,
}

impl<'a, S, T> Parser<'a, S, T> {
  pub fn new(grammar: &'a Grammar<S, T>) -> Self {
    let indexed = index(grammar);
    Self { debug: false, grammar, indexed, skip_count: 0, skip_penalty: 0.0 }
  }

  pub fn parse<'b>(&self, input: &'b str) -> Option<Derivation<'b, S, T>>
  where
    'a: 'b,
  {
    let tokens = self.grammar.lexer.lex(input);
    let mut chart = Chart::new(&self.indexed, self);
    for token in tokens.iter() {
      chart.process_token(token);
    }
    chart.get_result()
  }

  pub fn value(&self, input: &str) -> Option<T> {
    self.parse(input).map(|x| x.value)
  }

  pub fn set_debug(mut self, debug: bool) -> Self {
    self.debug = debug;
    self
  }

  pub fn set_skip_count(mut self, skip_count: usize) -> Self {
    self.skip_count = skip_count;
    self
  }

  pub fn set_skip_penalty(mut self, skip_penalty: f32) -> Self {
    self.skip_penalty = skip_penalty;
    self
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use base::{Lexer, Match, RuleData, Semantics, Tense, TermData};
  use std::marker::PhantomData;
  use test::Bencher;

  struct CharacterLexer<T: Default> {
    base: Rc<Match<T>>,
    mark: PhantomData<T>,
  }

  impl<T: Default> Default for CharacterLexer<T> {
    fn default() -> Self {
      let base = Rc::new(Match { data: TermData::default(), value: T::default() });
      Self { base, mark: PhantomData }
    }
  }

  impl<T: Default> Lexer<(), T> for CharacterLexer<T> {
    fn fix(&self, _: &Match<T>, _: &Tense) -> Vec<Rc<Match<T>>> {
      unimplemented!()
    }

    fn lex<'a: 'b, 'b>(&'a self, input: &'b str) -> Vec<Token<'b, T>> {
      let map = input.char_indices().map(|(i, x)| {
        let text = &input[i..i + x.len_utf8()];
        let mut matches = FxHashMap::default();
        matches.insert(text, (0.0, Rc::clone(&self.base)));
        matches.insert("%ch", (0.0, Rc::clone(&self.base)));
        Token { matches, text }
      });
      map.collect()
    }

    fn unlex(&self, _: &str, _: &()) -> Vec<Rc<Match<T>>> {
      unimplemented!()
    }
  }

  fn make_rule<F: Fn(&[T]) -> T + 'static, T>(lhs: usize, rhs: &str, f: F) -> Rule<(), T> {
    make_rule_score(lhs, rhs, f, 0.0)
  }

  fn make_rule_score<F: Fn(&[T]) -> T + 'static, T>(
    lhs: usize,
    rhs: &str,
    f: F,
    score: f32,
  ) -> Rule<(), T> {
    let merge: Semantics<Fn(&[T]) -> T> = Semantics { callback: Box::new(f), score };
    let split: Semantics<Fn(&()) -> Vec<Vec<()>>> =
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

  #[test]
  fn scoring_works() {
    let grammar = Grammar {
      key: Box::new(|_| unimplemented!()),
      lexer: Box::new(CharacterLexer::default()),
      names: "$Root $As $Bs $Neither $A $B".split(' ').map(|x| x.to_string()).collect(),
      rules: vec![
        make_rule_score(0, "$1", |x| x.join(""), 0.0),
        make_rule_score(0, "$2", |x| x.join(""), 0.0),
        make_rule_score(0, "$3", |x| x.join(""), 0.0),
        make_rule_score(1, "$1 $4", |x| x.join(""), 0.0),
        make_rule_score(1, "", |x| x.join(""), 0.0),
        make_rule_score(4, "a", |_| "a".to_string(), 1.0),
        make_rule_score(4, "%ch", |x| x.join(""), -1.0),
        make_rule_score(2, "$2 $5", |x| x.join(""), 0.0),
        make_rule_score(2, "", |x| x.join(""), 0.0),
        make_rule_score(5, "b", |_| "b".to_string(), 1.0),
        make_rule_score(5, "%ch", |x| x.join(""), -1.0),
        make_rule_score(3, "$3 %ch", |x| x.join(""), 0.0),
        make_rule_score(3, "", |x| x.join(""), 0.0),
      ],
      start: 0,
    };
    let parser = Parser::new(&grammar);
    assert_eq!(parser.value("aaa"), Some("aaa".to_string()));
    assert_eq!(parser.value("aab"), Some("aa".to_string()));
    assert_eq!(parser.value("abb"), Some("bb".to_string()));
    assert_eq!(parser.value("bab"), Some("bb".to_string()));
    assert_eq!(parser.value("b?b"), Some("bb".to_string()));
    assert_eq!(parser.value("b??"), Some("".to_string()));
  }

  #[test]
  fn skipping_works() {
    let grammar = Grammar {
      key: Box::new(|_| unimplemented!()),
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
    let skip = |x| Parser::new(&grammar).set_skip_count(x).set_skip_penalty(-1.0);
    assert_eq!(skip(0).value("1+2+3   "), Some(6));
    assert_eq!(skip(0).value("1+2?+3  "), None);
    assert_eq!(skip(0).value("1+2+3  ?"), None);
    assert_eq!(skip(1).value("1+2?+3 ?"), Some(6));
    assert_eq!(skip(1).value("1+2?+3  "), Some(6));
    assert_eq!(skip(1).value("1+2+3  ?"), Some(6));
    assert_eq!(skip(1).value("1+2?+3 ?"), Some(6));
    assert_eq!(skip(1).value("1+2??+3 "), None);
    assert_eq!(skip(1).value("1+2+3 ??"), None);
    assert_eq!(skip(2).value("1+2??+3 "), Some(6));
    assert_eq!(skip(2).value("1+2+3 ??"), Some(6));
  }

  #[bench]
  fn parsing_benchmark(b: &mut Bencher) {
    let grammar = Grammar {
      key: Box::new(|_| unimplemented!()),
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
    let parser = Parser::new(&grammar);
    assert_eq!(parser.value("(1+2)*3-4+5*6"), Some(35));
    assert_eq!(parser.value("1+2*(3-4)+5*6"), Some(29));
    assert_eq!(parser.value("1+2*3-4)+5*(6"), None);
    b.iter(|| parser.value("(1+2)*3-4+5*6"));
  }
}
