import {Derivation, Leaf} from './derivation';
import {Grammar, Rule, Term} from './grammar';
import {Lexer, Match, Token} from './lexer';

// A State is a rule accompanied with a "cursor" and a "start", where the
// cursor is the position in the rule up to which we have a match and the
// start is the token from which this match started.

type Next = {leaf: Leaf, token: true} | {state: State, token: false};

interface State {
  candidates?: [State, Next][],
  cursor: number,
  next?: Next,
  prev?: State,
  rule: Rule,
  score?: number,
  start: number,
  wanted_by: State[],
}

const derive_leaf = (leaf: Leaf): Derivation => {
  const value = {some: leaf.match.value};
  return {type: 'leaf', leaf, value};
}

const derive_state = (state: State): Derivation => {
  const xs: Derivation[] = [];
  let current: State = state;
  for (let i = current.cursor; i--;) {
    const next = current.next!;
    xs.push(next.token ? derive_leaf(next.leaf) : derive_state(next.state));
    current = current.prev!;
  }
  const values = xs.reverse().map((x) => x.value!.some);
  const value = {some: state.rule.transform(values)};
  return {type: 'node', rule: state.rule, value, xs};
}

const make_state = (rule: Rule, start: number, wanted_by: State[]): State =>
    ({cursor: 0, rule, start, wanted_by});

const print_state = (state: State): string => {
  const suffix = `, from: ${state.start} (score: ${state.score})`;
  return `{${Grammar.print_rule(state.rule, state.cursor)}}${suffix}`;
}

// A Column is a list of states all which all end at the same token index.

interface Column {
  grammar: Grammar,
  index: number,
  states: State[],
  structures: {
    completed: {[name: string]: State[]},
    map: Map<number,[State, Next][]>,
    scannable: State[],
    wanted: {[name: string]: State[]},
  },
  token?: Token,
}

const advance_state = (map: Map<number,[State, Next][]>, max_index: number,
                       prev: State, states: State[]): [State, Next][] => {
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
}

const fill_column = (column: Column) => {
  const {completed, map, scannable, wanted} = column.structures;
  const max_index = column.grammar.max_index;
  const states = column.states;

  /* tslint:disable-next-line:prefer-for-of */
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    if (state.cursor === state.rule.rhs.length) {
      // Handle completed states, while keeping track of nullable ones.
      const next: Next = {state, token: false};
      const wanted_by = state.wanted_by;
      for (let j = wanted_by.length; j--;) {
        const prev = wanted_by[j];
        advance_state(map, max_index, prev, states).push([prev, next]);
      }
      if (state.start === column.index) {
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
        if (nulls.length > 0) {
          const advanced = advance_state(map, max_index, state, states);
          for (let j = nulls.length; j--;) {
            advanced.push([state, {state: nulls[j], token: false}]);
          }
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

  // After generating all paths, score states and choose one "next" for each.
  for (let i = states.length; i--;) {
    score_state(states[i]);
  }

  return column;
}

const get_debug_header = (column: Column): string => {
  const token = column.token;
  if (!token) return `Column ${column.index}`;
  const [start, end] = token.range;
  const text = token.input.substring(start, end);
  return `Column ${column.index}: ${JSON.stringify(text)}`;
}

const make_column = (grammar: Grammar, index: number): Column => {
  const column: Column = {
    grammar,
    index: index,
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
  const wanted_by = column.structures.wanted[grammar.start] = [];
  for (let j = rules.length; j--;) {
    column.states.push(make_state(rules[j], index, wanted_by));
  }
  return fill_column(column);
}

const next_column = (prev: Column, token: Token): Column => {
  const column = make_column(prev.grammar, prev.index + 1);
  const map = column.structures.map;
  const max_index = column.grammar.max_index;
  const scannable = prev.structures.scannable;
  for (let i = scannable.length; i--;) {
    const state = scannable[i];
    const term: any = state.rule.rhs[state.cursor];
    const match = !!term.text ? token.text_matches[term.text] :
                                token.type_matches[term.type];
    if (!!match) {
      const next: Next = {leaf: {match, term, token}, token: true};
      advance_state(map, max_index, state, column.states).push([state, next]);
    }
  }
  column.token = token;
  return fill_column(column);
}

const score_state = (state: State): number => {
  if (state.score != null) return state.score;
  if (state.cursor === 0) return state.score = state.rule.score;
  const candidates = state.candidates!;
  let best_candi: [State, Next] | null = null;
  let best_score = -Infinity;
  for (let i = candidates.length; i--;) {
    const [prev, next] = candidates[i];
    const next_score = next.token ? next.leaf.match.score
                                  : score_state(next.state);
    const score = score_state(prev) + next_score;
    if (score > best_score) {
      best_candi = candidates[i];
      best_score = score;
    }
  }
  candidates.length = 0;
  [state.prev, state.next] = best_candi!;
  return state.score = best_score;
}

// A Parser allows us to parse token sequences with a grammar. Constructing a
// parser is a lightweight operation, but Parsers are stateful, so each one
// can only be used to parse a single token sequence.

class Parser {
  private column: Column;
  private grammar: Grammar;
  private input?: string;
  constructor(grammar: Grammar) {
    this.column = make_column(grammar, 0);
    this.grammar = grammar;
    this.maybe_throw(() => `No rules for initial state: ${grammar.start}`);
  }
  debug(): string {
    const xs = [get_debug_header(this.column)];
    this.column.states.forEach((x, i) => xs.push(`${i}: ${print_state(x)}`));
    return xs.join('\n');
  }
  feed(token: Token) {
    const last_column = this.column;
    this.column = next_column(this.column, token);
    this.input = token.input;
    this.maybe_throw(() => {
      const terms = last_column.structures.scannable.map(
          (x) => Grammar.print_term(x.rule.rhs[x.cursor]));
      const unique = terms.sort().filter((x, i) => terms.indexOf(x) === i);
      return Lexer.format_error(token, `Expected: ${unique.join(' | ')}:`);
    });
  }
  result(): Derivation {
    const start = this.grammar.start;
    const match = (x: State) => x.cursor === x.rule.rhs.length &&
                                x.rule.lhs === start && x.start === 0;
    const states = this.column.states.filter(match).sort(
        (x, y) => y.score! - x.score!);
    if (states.length === 0) {
      const message = JSON.stringify(this.input || '');
      throw Error(`Unexpected end of input: ${message}`);
    }
    return derive_state(states[0]);
  }
  static parse(grammar: Grammar, input: string): Derivation {
    const parser = new Parser(grammar);
    grammar.lexer.lex(input).forEach((x) => parser.feed(x));
    return parser.result();
  }
  private maybe_throw(message: () => string) {
    if (this.column.states.length === 0) throw Error(message());
  }
}

export {Parser};
