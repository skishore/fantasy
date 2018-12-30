import {Option, flatten} from '../lib/base';
import {Grammar, Lexer, Match, Rule, Term, Token} from './base';

// A State is a rule accompanied with a "cursor" and a "start", where the
// cursor is the position in the rule up to which we have a match and the
// start is the token from which this match started.

type Next<T> = {leaf: true; match: Match<T>} | {leaf: false; state: State<T>};

interface State<T> {
  candidates?: [State<T>, Next<T>][];
  cursor: number;
  next?: Next<T>;
  prev?: State<T>;
  rule: IRule<T>;
  score: number;
  start: number;
  wanted_by: State<T>[];
}

const evaluate_state = <T>(state: State<T>): T => {
  const xs: T[] = [];
  let current: State<T> = state;
  for (let i = current.cursor; i--; ) {
    const next = current.next!;
    xs.push(next.leaf ? next.match.value : evaluate_state(next.state));
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
  score: -Infinity,
  start,
  wanted_by,
});

// A Column is a list of states all which all end at the same token index.

interface Column<T> {
  grammar: IGrammar<T>;
  index: number;
  states: State<T>[];
  structures: {
    completed: State<T>[];
    map: Map<number, [State<T>, Next<T>][]>;
    nullable: {[name: string]: State<T>[]};
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
    score: -Infinity,
    start: prev.start,
    wanted_by: prev.wanted_by,
  };
  map.set(key, new_state.candidates);
  states.push(new_state);
  return new_state.candidates;
};

const fill_column = <T>(column: Column<T>): Column<T> => {
  const {completed, map, nullable, scannable, wanted} = column.structures;
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
      if (state.start === 0) {
        completed.push(state);
      }
      if (state.start === column.index) {
        const lhs = state.rule.lhs;
        (nullable[lhs] = nullable[lhs] || []).push(state);
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
        const nulls = nullable[value] || [];
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
      completed: [],
      map: new Map(),
      nullable: {},
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
  const column = make_column(prev.grammar, prev.index + 1);
  const map = column.structures.map;
  const max_index = column.grammar.max_index;
  const scannable = prev.structures.scannable;
  for (let i = scannable.length; i--; ) {
    const state = scannable[i];
    const {type, value} = state.rule.rhs[state.cursor];
    const match =
      (type === 'text' && token.text_matches[value]) ||
      (type === 'type' && token.type_matches[value]);
    if (match) {
      const next: Next<T> = {leaf: true, match};
      advance_state(map, max_index, state, column.states).push([state, next]);
    }
  }
  column.token = token;
  return fill_column(column);
};

const score_state = <T>(state: State<T>): number => {
  if (state.score > -Infinity) return state.score;
  if (state.cursor === 0) return (state.score = state.rule.score);
  const candidates = state.candidates!;
  let best_candidate: [State<T>, Next<T>] | null = null;
  let best_score = -Infinity;
  for (let i = candidates.length; i--; ) {
    const [prev, next] = candidates[i];
    const next_score = next.leaf ? next.match.score : score_state(next.state);
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
  const text_matches = get_matches(token.text_matches, '');
  const type_matches = get_matches(token.type_matches, '%');
  const matches = text_matches.concat(type_matches).join('\n');
  return `Column ${column.index}: ${JSON.stringify(token.text)}\n${matches}`;
};

const get_matches = <T>(m: {[x: string]: Match<T>}, pre: string): string[] => {
  const xs = Object.keys(m).sort();
  return xs.map(x => `  ${pre}${x} (score: ${m[x].score})`);
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

interface IRule<T> {
  fn: (xs: T[]) => T;
  index: number;
  lhs: string;
  rhs: Term[];
  score: number;
}

const index = <S, T>(grammar: Grammar<S, T>): IGrammar<T> => {
  let index = 0;
  const by_name: {[name: string]: IRule<T>[]} = {};
  grammar.rules.forEach(x => {
    if (x.merge.score === -Infinity) return;
    const {lhs, rhs, merge} = x;
    const {fn, score} = merge;
    (by_name[lhs] = by_name[lhs] || []).push({fn, index, lhs, rhs, score});
    index += rhs.length + 1;
  });
  return {...grammar, by_name, max_index: index} as IGrammar<T>;
};

// Fault-tolerant parsing helpers.

type Delta<T> = {completed: State<T>[]; scannable: State<T>[]};

const penalize = <T>(penalty: number, states: State<T>[][]) => {
  if (states.length === 1) return states[0];
  states = states.slice().reverse();
  const add = (x: number) => (y: State<T>) => ({...y, score: y.score + x});
  return flatten(states.map((x, i) => (i === 0 ? x : x.map(add(i * penalty)))));
};

const update = <T>(column: Column<T>, delta: Delta<T>[], window: number) => {
  if (delta.length > window) delta.shift();
  const {completed, scannable} = column.structures;
  delta.push({completed, scannable});
};

// Our public interface is a pure parsing function returning an Option<T>.

interface Options {
  debug?: boolean;
  penalty?: number;
  window?: number;
}

const parse = <S, T>(
  grammar: Grammar<S, T>,
  input: string,
  options?: Options,
): Option<T> => {
  // Set default values of our options.
  const debug = options && options.debug;
  const penalty = (options && options.penalty) || 0;
  const window = (options && options.window) || 0;

  // Construct our our first column and our scannable window.
  const indexed = index(grammar);
  let column = make_column(indexed, 0);
  // tslint:disable-next-line:no-console
  if (debug) console.log(print_column(column));
  const delta: Delta<T>[] = [];

  // Process each token and update our columnar state.
  if (column.states.length === 0) return null;
  for (const token of grammar.lexer.lex(input)) {
    update(column, delta, window);
    const scannable = penalize(penalty, delta.map(x => x.scannable));
    column.structures.scannable = scannable;
    column = next_column(column, token);
    // tslint:disable-next-line:no-console
    if (debug) console.log(print_column(column));
  }

  // Get the winning top-level state.
  update(column, delta, window);
  const match = (x: State<T>) => x.rule.lhs === grammar.start;
  const states = penalize(penalty, delta.map(x => x.completed.filter(match)));
  if (states.length === 0) return null;
  states.sort((x, y) => y.score! - x.score!);
  return {some: evaluate_state(states[0])};
};

const Parser = {parse};

export {Parser};
