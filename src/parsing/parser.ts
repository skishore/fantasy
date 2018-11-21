import {Option} from '../lib/base';
import {Grammar, Lexer, Rule, Term, Token} from './grammar';

// A State is a rule accompanied with a "cursor" and a "start", where the
// cursor is the position in the rule up to which we have a match and the
// start is the token from which this match started.

type Next<T> = {leaf: true; token: Token<T>} | {leaf: false; state: State<T>};

interface State<T> {
  candidates?: [State<T>, Next<T>][];
  cursor: number;
  next?: Next<T>;
  prev?: State<T>;
  rule: IRule<T>;
  score?: number;
  start: number;
  wanted_by: State<T>[];
}

const evaluate_state = <T>(state: State<T>): T => {
  const xs: T[] = [];
  let current: State<T> = state;
  for (let i = current.cursor; i--; ) {
    const next = current.next!;
    xs.push(next.leaf ? next.token.value : evaluate_state(next.state));
    current = current.prev!;
  }
  return state.rule.fn(xs.reverse());
};

const make_state = <T>(
  rule: IRule<T>,
  start: number,
  wanted_by: State<T>[],
): State<T> => ({
  cursor: 0,
  rule,
  start,
  wanted_by,
});

// A Column is a list of states all which all end at the same token index.

interface Column<T> {
  grammar: IGrammar<T>;
  index: number;
  states: State<T>[];
  structures: {
    completed: {[name: string]: State<T>[]};
    map: Map<number, [State<T>, Next<T>][]>;
    scannable: State<T>[];
    wanted: {[name: string]: State<T>[]};
  };
  token?: Token<T>;
}

const advance_state = <T>(
  map: Map<number, [State<T>, Next<T>][]>,
  max_index: number,
  prev: State<T>,
  states: State<T>[],
): [State<T>, Next<T>][] => {
  const key = prev.cursor + prev.rule.index + prev.start * max_index;
  const existing = map.get(key);
  if (existing) return existing;
  const new_state = {
    candidates: [],
    cursor: prev.cursor + 1,
    rule: prev.rule,
    start: prev.start,
    wanted_by: prev.wanted_by,
  };
  map.set(key, new_state.candidates);
  states.push(new_state);
  return new_state.candidates;
};

const fill_column = <T>(column: Column<T>): Column<T> => {
  const {completed, map, scannable, wanted} = column.structures;
  const max_index = column.grammar.max_index;
  const states = column.states;

  /* tslint:disable-next-line:prefer-for-of */
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    if (state.cursor === state.rule.rhs.length) {
      // Handle completed states, while keeping track of nullable ones.
      const next: Next<T> = {leaf: false, state};
      const wanted_by = state.wanted_by;
      for (let j = wanted_by.length; j--; ) {
        const prev = wanted_by[j];
        advance_state(map, max_index, prev, states).push([prev, next]);
      }
      if (state.start === column.index) {
        const lhs = state.rule.lhs;
        (completed[lhs] = completed[lhs] || []).push(state);
      }
    } else {
      // Queue up scannable states.
      const {type, value} = state.rule.rhs[state.cursor];
      if (type !== 'name') {
        scannable.push(state);
        continue;
      }
      // Queue up predicted states.
      if (wanted[value]) {
        wanted[value].push(state);
        const nulls = completed[value] || [];
        if (nulls.length > 0) {
          const advanced = advance_state(map, max_index, state, states);
          for (let j = nulls.length; j--; ) {
            advanced.push([state, {leaf: false, state: nulls[j]}]);
          }
        }
      } else {
        const index = column.index;
        const rules = column.grammar.by_name[value] || [];
        const wanted_by = (wanted[value] = [state]);
        for (let j = rules.length; j--; ) {
          states.push(make_state(rules[j], index, wanted_by));
        }
      }
    }
  }

  // After generating all paths, score states and choose one "next" for each.
  for (let i = states.length; i--; ) {
    score_state(states[i]);
  }

  return column;
};

const make_column = <T>(grammar: IGrammar<T>, index: number): Column<T> => {
  const column: Column<T> = {
    grammar,
    index,
    states: [],
    structures: {
      completed: {},
      map: new Map(),
      scannable: [],
      wanted: {},
    },
  };
  if (index > 0) return column;
  const rules = grammar.by_name[grammar.start] || [];
  const wanted_by = (column.structures.wanted[grammar.start] = []);
  for (let j = rules.length; j--; ) {
    column.states.push(make_state(rules[j], index, wanted_by));
  }
  return fill_column(column);
};

const next_column = <T>(prev: Column<T>, token: Token<T>): Column<T> => {
  const {text, type} = token;
  const column = make_column(prev.grammar, prev.index + 1);
  const map = column.structures.map;
  const max_index = column.grammar.max_index;
  const scannable = prev.structures.scannable;
  for (let i = scannable.length; i--; ) {
    const state = scannable[i];
    const {type: term_type, value} = state.rule.rhs[state.cursor];
    const match =
      (term_type === 'text' && value === text) ||
      (term_type === 'type' && value === type);
    if (match) {
      const next: Next<T> = {leaf: true, token};
      advance_state(map, max_index, state, column.states).push([state, next]);
    }
  }
  column.token = token;
  return fill_column(column);
};

const score_state = <T>(state: State<T>): number => {
  if (state.score != null) return state.score;
  if (state.cursor === 0) return (state.score = state.rule.score);
  const candidates = state.candidates!;
  let best_candidate: [State<T>, Next<T>] | null = null;
  let best_score = -Infinity;
  for (let i = candidates.length; i--; ) {
    const [prev, next] = candidates[i];
    const next_score = next.leaf ? next.token.score : score_state(next.state);
    const score = score_state(prev) + next_score;
    if (score > best_score) {
      best_candidate = candidates[i];
      best_score = score;
    }
  }
  candidates.length = 0;
  [state.prev, state.next] = best_candidate!;
  return (state.score = best_score);
};

// Debugging helpers.

const get_debug_header = <T>(column: Column<T>): string => {
  const token = column.token;
  if (!token) return `Column ${column.index}`;
  return `Column ${column.index}: ${JSON.stringify(token.text)}`;
};

const print_column = <T>(column: Column<T>): string => {
  const xs = [get_debug_header(column)];
  column.states.forEach((x, i) => xs.push(`${i}: ${print_state(x)}`));
  return xs.concat('').join('\n');
};

const print_rule = <T>(rule: IRule<T>, cursor?: number): string => {
  const terms = rule.rhs.map(x => `${x.type === 'type' ? '%' : ''}${x.value}`);
  if (cursor != null) terms.splice(cursor, 0, '●');
  return `${rule.lhs} -> ${terms.join(' ')}`;
};

const print_state = <T>(state: State<T>): string => {
  const suffix = `, from: ${state.start} (score: ${state.score})`;
  return `{${print_rule(state.rule, state.cursor)}}${suffix}`;
};

// An IGrammar is a slight modification to grammar that includes extra data
// structures needed by our parsing algorithm. We use it to implement parse.

interface IGrammar<T> extends Grammar<unknown, T> {
  by_name: {[lhs: string]: IRule<T>[]};
  max_index: number;
}

interface IRule<T> extends Rule<unknown, T> {
  fn: (xs: T[]) => T;
  index: number;
  score: number;
}

const index = <T>(grammar: Grammar<unknown, T>): IGrammar<T> => {
  let max_index = 0;
  const by_name: {[name: string]: IRule<T>[]} = {};
  grammar.rules.forEach(x => {
    if (x.merge.score === -Infinity) return;
    const indexed = {...x, ...x.merge, index: max_index};
    (by_name[x.lhs] = by_name[x.lhs] || []).push(indexed);
    max_index += x.rhs.length + 1;
  });
  return {...grammar, by_name, max_index};
};

const parse = <T>(
  grammar: Grammar<unknown, T> | IGrammar<T>,
  input: string,
  debug: boolean = false,
): Option<T> => {
  // Process each token and update our columnar state.
  const indexed = (grammar as IGrammar<T>).max_index
    ? (grammar as IGrammar<T>)
    : index(grammar);
  let column = make_column(indexed, 0);
  // tslint:disable-next-line:no-console
  if (debug) console.log(print_column(column));
  if (column.states.length === 0) return null;
  for (const token of grammar.lexer.lex(input)) {
    column = next_column(column, token);
    // tslint:disable-next-line:no-console
    if (debug) console.log(print_column(column));
    if (column.states.length === 0) return null;
  }

  // Get the winning top-level state.
  const match = (x: State<T>) =>
    x.cursor === x.rule.rhs.length &&
    x.rule.lhs === grammar.start &&
    x.start === 0;
  const states = column.states.filter(match);
  if (states.length === 0) return null;
  states.sort((x, y) => y.score! - x.score!);
  return {some: evaluate_state(states[0])};
};

const Parser = {index, parse};

export {Parser};
