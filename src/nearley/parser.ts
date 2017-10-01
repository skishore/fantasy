
// A Grammar is a list of rules along with an index to access them.

interface Grammar {
  by_name: {[name: string]: Rule[]},
  rules: Rule[],
  start: string,
}

// A Rule is a single production option in a grammar.

type Rule = {
  id: number,
  lhs: string,
  rhs: Term[],
  preprocess: (xs: Object[]) => Object,
}

type Term = string | {literal: string};

const print_rule = (rule: Rule, cursor?: number): string => {
  const print_term = (term: Term) =>
      typeof term === 'string' ? term : JSON.stringify(term.literal);
  const xs = rule.rhs.map(print_term);
  const ys = cursor == null ? xs.join(' ') :
      xs.slice(0, cursor).join(' ') + ' ● ' + xs.slice(cursor).join(' ');
  return rule.lhs + ' → ' + ys;
}

// A State is a rule accompanied with a "cursor" and a "start", where the
// cursor is the position in the rule up to which we have a match and the
// start is the token from which this match started.

interface BaseState {
  cursor: number,
  next?: NextState,
  prev?: State,
  rule: Rule,
  start: number,
  wanted_by: IncompleteState[],
}

interface CompleteState extends BaseState {complete: true, data: Object}

interface IncompleteState extends BaseState {complete: false}

interface NextState {data: Object};

type State = CompleteState | IncompleteState;

const fill_state = (state: IncompleteState): State => {
  if (state.cursor < state.rule.rhs.length) return state;
  const xs = [];
  let current: State = state;
  for (let i = current.cursor; i--;) {
    xs.push(current.next!.data);
    current = current.prev!;
  }
  const preprocess = state.rule.preprocess;
  const data = preprocess ? preprocess(xs.reverse()) : xs.reverse();
  return Object.assign(state, {complete: true, data});
}

const make_state = (
    rule: Rule, start: number, wanted_by: IncompleteState[]): State =>
  fill_state({complete: false, cursor: 0, rule, start, wanted_by});

const next_state = (prev: IncompleteState, next: NextState): State =>
  fill_state(Object.assign({}, prev, {cursor: prev.cursor + 1, prev, next}));

const print_state = (state: State): string =>
  `{${print_rule(state.rule, state.cursor)}}, from: ${state.start}`;

// A Column is a list of states all which all end at the same token index.

interface Column {
  grammar: Grammar,
  index: number,
  states: State[],
  states_completed: {[name: string]: CompleteState[]},
  states_scannable: IncompleteState[],
  states_wanted: {[name: string]: IncompleteState[]},
}

const fill_column = (column: Column) => {
  const completed = column.states_completed;
  const scannable = column.states_scannable;
  const states = column.states;
  const wanted = column.states_wanted;

  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    if (state.complete) {
      // Handle completed states, while keeping track of nullable ones.
      const wanted_by = state.wanted_by;
      for (let i = wanted_by.length; i--;) {
        states.push(next_state(wanted_by[i], state));
      }
      if (state.cursor === 0) {
        const lhs = state.rule.lhs;
        (completed[lhs] = completed[lhs] || []).push(state);
      }
    } else {
      // Queue up scannable states.
      const term = state.rule.rhs[state.cursor];
      if (typeof term !== 'string') {
        scannable.push(state);
        continue;
      }
      // Queue up predicted states.
      if (wanted[term]) {
        wanted[term].push(state);
        const nulls = completed[term] || [];
        for (let j = nulls.length; j--;) {
          states.push(next_state(state, nulls[j]));
        }
      } else {
        const index = column.index;
        const rules = column.grammar.by_name[term] || [];
        const wanted_by = wanted[term] = [state];
        for (let j = rules.length; j--;) {
          states.push(make_state(rules[j], index, wanted_by));
        }
      }
    }
  }

  return column;
}

const make_column = (grammar: Grammar, index: number): Column => {
  const column: Column = {
    grammar,
    index: index,
    states: [],
    states_completed: {},
    states_scannable: [],
    states_wanted: {}
  };
  if (index > 0) return column;
  const rules = grammar.by_name[grammar.start] || [];
  const wanted_by = column.states_wanted[grammar.start] = [];
  for (let j = rules.length; j--;) {
    column.states.push(make_state(rules[j], index, wanted_by));
  }
  return fill_column(column);
}

const next_column = (prev: Column, token: string): Column => {
  const column = make_column(prev.grammar, prev.index + 1);
  const scannable = prev.states_scannable;
  for (let i = scannable.length; i--;) {
    const state = scannable[i];
    const term = state.rule.rhs[state.cursor];
    if (typeof term !== 'string' && term.literal === token) {
      column.states.push(next_state(state, {data: token}));
    }
  }
  return fill_column(column);
}

// A Parser allows us to parse token sequences with a grammar. Constructing a
// parser is a lightweight operation, but Parsers are stateful, so each one
// can only be used to parse a single token sequence.

class Parser {
  private column: Column;
  private grammar: Grammar;
  constructor(grammar: Grammar) {
    this.column = make_column(grammar, 0);
    this.grammar = grammar;
    this.maybe_throw(`No rules for initial state: ${grammar.start}`);
  }
  feed(token: string) {
    this.column = next_column(this.column, token);
    this.maybe_throw(`Unexpected token: ${token}`);
  }
  parses(): Object[] {
    const start = this.grammar.start;
    const match = (x: State) => x.complete && x.start === 0 &&
                                x.rule.lhs === start;
    return this.column.states.filter(match).map((x: CompleteState) => x.data);
  }
  private maybe_throw(message: string) {
    if (this.column.states.length === 0) throw Error(message);
  }
}

export {Grammar, Parser, Rule};
