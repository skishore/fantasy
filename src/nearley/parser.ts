// A Grammar is a list of rules along with an index to access them.

interface RuleSpec {
  lhs: string,
  rhs: Term[],
  score?: number,
  transform?: Transform,
}

class GrammarBuilder {
  private index: number = 0;
  private names: Set<string> = new Set();
  private rules: Rule[] = [];
  add(rule: RuleSpec) {
    this.rules.push({...rule, index: this.index, score: rule.score || 0});
    this.index += rule.rhs.length + 1;
  }
  build(start?: string): Grammar {
    const rules = this.rules;
    const max_index = this.index;
    const by_name: {[name: string]: Rule[]} = {};
    rules.forEach((x) => (by_name[x.lhs] = by_name[x.lhs] || []).push(x));
    return {by_name, max_index, rules, start: start || rules[0].lhs};
  }
}

interface Grammar {
  by_name: {[name: string]: Rule[]},
  max_index: number,
  rules: Rule[],
  start: string,
}

// A Rule is a single production option in a grammar.

type Rule = {
  index: number,
  lhs: string,
  rhs: Term[],
  score: number,
  transform?: Transform,
}

type Term = string | {literal: string} | RegExp;

type Transform = (xs: Object[]) => Object;

const print_rule = (rule: Rule, cursor?: number): string => {
  const print_term = (term: Term) =>
      typeof term === 'string' ? term :
             term instanceof RegExp ? term.toString() :
             JSON.stringify(term.literal);
  const terms = rule.rhs.map(print_term);
  if (cursor != null) terms.splice(cursor, 0, '●');
  return `${rule.lhs} -> ${terms.join(' ')}`;
}

// A State is a rule accompanied with a "cursor" and a "start", where the
// cursor is the position in the rule up to which we have a match and the
// start is the token from which this match started.

type Next = {data: Object, terminal: true} | {state: State, terminal: false};

interface State {
  cursor: number,
  next?: Next[],
  prev?: State,
  rule: Rule,
  score?: number,
  start: number,
  wanted_by: State[],
}

const fill_state = (state: State): Object => {
  const data = [];
  let current: State = state;
  for (let i = current.cursor; i--;) {
    const next = current.next![0];
    data.push(next.terminal ? next.data : fill_state(next.state));
    current = current.prev!;
  }
  data.reverse();
  const transform = state.rule.transform;
  return transform ? transform(data) : data;
}

const make_state = (rule: Rule, start: number, wanted_by: State[]): State =>
    ({cursor: 0, rule, start, wanted_by});

const print_state = (state: State): string =>
    `{${print_rule(state.rule, state.cursor)}}, from: ${state.start}`;

// A Column is a list of states all which all end at the same token index.

interface Column {
  grammar: Grammar,
  index: number,
  states: State[],
  structures: {
    completed: {[name: string]: State[]},
    map: Map<number,Next[]>,
    scannable: State[],
    wanted: {[name: string]: State[]},
  },
}

const advance_state = (map: Map<number,Next[]>, max_index: number,
                       prev: State, states: State[]): Next[] => {
  const key = prev.cursor + prev.rule.index + prev.start * max_index;
  const existing = map.get(key);
  if (existing) return existing;
  const new_state = {...prev, cursor: prev.cursor + 1, next: [], prev};
  map.set(key, new_state.next);
  states.push(new_state);
  return new_state.next;
}

const fill_column = (column: Column) => {
  const {completed, map, scannable, wanted} = column.structures;
  const max_index = column.grammar.max_index;
  const states = column.states;

  /* tslint:disable:prefer-for-of */
  for (let i = 0; i < states.length; i++) {
  /* tslint:enable:prefer-for-of */
    const state = states[i];
    if (state.cursor === state.rule.rhs.length) {
      // Handle completed states, while keeping track of nullable ones.
      const next: Next = {state, terminal: false};
      const wanted_by = state.wanted_by;
      for (let j = wanted_by.length; j--;) {
        advance_state(map, max_index, wanted_by[j], states).push(next);
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
        if (nulls.length > 0) {
          const next = advance_state(map, max_index, state, states);
          for (let j = nulls.length; j--;) {
            next.push({state: nulls[j], terminal: false});
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

const next_column = (prev: Column, token: string): Column => {
  const column = make_column(prev.grammar, prev.index + 1);
  const map = column.structures.map;
  const max_index = column.grammar.max_index;
  const next: Next = {data: token, terminal: true};
  const scannable = prev.structures.scannable;
  for (let i = scannable.length; i--;) {
    const state = scannable[i];
    const term = state.rule.rhs[state.cursor];
    if (typeof term !== 'string' &&
        (term instanceof RegExp ? term.test(token) : term.literal === token)) {
      advance_state(map, max_index, state, column.states).push(next);
    }
  }
  return fill_column(column);
}

const score_state = (state: State): number => {
  if (state.score != null) return state.score;
  if (state.cursor === 0) return state.score = state.rule.score;
  const next = state.next!;
  let best_nexti: Next | null = null;
  let best_score = -Infinity;
  for (let i = next.length; i--;) {
    const nexti = next[i];
    const score = nexti.terminal ? 0 : score_state(nexti.state);
    if (score > best_score) {
      best_nexti = nexti;
      best_score = score;
    }
  }
  state.next = [best_nexti!];
  return state.score = best_score + score_state(state.prev!);
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
  debug(): string {
    const column = this.column;
    const lines = [`Column: ${column.index}`];
    column.states.forEach((x, i) => lines.push(`${i}: ${print_state(x)}`));
    return lines.join('\n');
  }
  feed(token: string) {
    this.column = next_column(this.column, token);
    this.maybe_throw(`Unexpected token: ${token}`);
  }
  result(): Object | null {
    const start = this.grammar.start;
    const match = (x: State) => x.cursor === x.rule.rhs.length &&
                                x.rule.lhs === start && x.start === 0;
    const states = this.column.states.filter(match).sort(
        (x, y) => y.score! - x.score!);
    return states.length === 0 ? null : fill_state(states[0]);
  }
  private maybe_throw(message: string) {
    if (this.column.states.length === 0) throw Error(message);
  }
}

export {Grammar, Parser, Rule};

// Tests of the parser above.

declare const require: any;
const fs = require('fs');
const util = require('util');
const config = {breakLength: Infinity, colors: true, depth: null};
const debug = (x: any) => util.inspect(x, config);

const make_nearley_grammar = (path: string) => {
  const nearley = require(path);
  const builder = new GrammarBuilder();
  nearley.ParserRules.forEach((x: any) => builder.add(
      {lhs: x.name, rhs: x.symbols, transform: x.postprocess}));
  return builder.build(nearley.ParserStart);
}

const path = '../../node_modules/nearley/lib/nearley-language-bootstrapped';
const grammar = make_nearley_grammar(path);

const name = 'node_modules/nearley/lib/nearley-language-bootstrapped.ne';
fs.readFile(name, {encoding: 'utf8'}, (error: Error, data: string) => {
  const lines: string[] = [];
  const start = Date.now();
  const parser = new Parser(grammar);
  for (const token of Array.from(data)) {
    parser.feed(token);
    lines.push(parser.debug());
  }
  const total = Date.now() - start;
  lines.push(debug(parser.result()));
  console.log(`${lines.join('\n\n')}\n\nTotal time: ${total}ms`);
});
