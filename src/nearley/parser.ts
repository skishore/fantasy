// A Grammar is a list of rules along with an index to access them.

class Builder {
  private index: number = 0;
  private names: Set<string> = new Set();
  private rules: Rule[] = [];
  add(lhs: string, rhs: Term[], transform?: Transform) {
    this.rules.push({index: this.index, lhs, rhs, transform});
    this.index += rhs.length + 1;
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
  next?: Next,
  prev?: State,
  rule: Rule,
  start: number,
  wanted_by: State[],
}

const fill_state = (state: State): Object => {
  const data = [];
  let current: State = state;
  for (let i = current.cursor; i--;) {
    const next = current.next!;
    data.push(next.terminal ? next.data : fill_state(next.state));
    current = current.prev!;
  }
  data.reverse();
  const transform = state.rule.transform;
  return transform ? transform(data) : data;
}

const make_state = (rule: Rule, start: number, wanted_by: State[]): State =>
    ({cursor: 0, rule, start, wanted_by});

const next_state = (prev: State, next: Next): State =>
    ({...prev, cursor: prev.cursor + 1, prev, next});

const print_state = (state: State): string =>
    `{${print_rule(state.rule, state.cursor)}}, from: ${state.start}`;

// A Column is a list of states all which all end at the same token index.

interface Column {
  grammar: Grammar,
  index: number,
  states: State[],
  states_completed: {[name: string]: State[]},
  states_scannable: State[],
  states_wanted: {[name: string]: State[]},
}

const complete_state = (completed_set: Set<number>, max_index: number,
                        prev: State, next: State, states: State[]) => {
  const key = prev.cursor + prev.rule.index + prev.start * max_index;
  if (completed_set.has(key)) return;
  completed_set.add(key);
  states.push(next_state(prev, {state: next, terminal: false}));
}

const fill_column = (column: Column) => {
  const completed_set = new Set<number>();
  const completed = column.states_completed;
  const max_index = column.grammar.max_index;
  const scannable = column.states_scannable;
  const states = column.states;
  const wanted = column.states_wanted;

  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    if (state.cursor === state.rule.rhs.length) {
      // Handle completed states, while keeping track of nullable ones.
      const wanted_by = state.wanted_by;
      for (let j = wanted_by.length; j--;) {
        complete_state(completed_set, max_index, wanted_by[j], state, states);
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
          complete_state(completed_set, max_index, state, nulls[j], states);
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
    states_wanted: {},
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
    if (typeof term !== 'string' &&
        (term instanceof RegExp ? term.test(token) : term.literal === token)) {
      column.states.push(next_state(state, {data: token, terminal: true}));
    }
  }
  return fill_column(column);
}

// A Parser allows us to parse token sequences with a grammar. Constructing a
// parser is a lightweight operation, but Parsers are stateful, so each one
// can only be used to parse a single token sequence.

interface Options {keep_history?: boolean}

class Parser {
  private column: Column;
  private grammar: Grammar;
  private options: Options;
  private table: Column[];
  constructor(grammar: Grammar, options: Options = {}) {
    this.column = make_column(grammar, 0);
    this.grammar = grammar;
    this.options = options;
    this.maybe_throw(`No rules for initial state: ${grammar.start}`);
    if (this.options.keep_history) this.table = [this.column];
  }
  debug(): string {
    const table = this.table || [this.column];
    const block = table.map((x) => {
      const lines = [`Column: ${x.index}`];
      x.states.forEach((y, i) => lines.push(`${i}: ${print_state(y)}`));
      return lines.join('\n');
    });
    return block.join('\n\n');
  }
  feed(token: string) {
    this.column = next_column(this.column, token);
    this.maybe_throw(`Unexpected token: ${token}`);
    if (this.options.keep_history) this.table.push(this.column);
  }
  parses(): Object[] {
    const start = this.grammar.start;
    const match = (x: State) => x.cursor === x.rule.rhs.length &&
                                x.rule.lhs === start && x.start === 0;
    return this.column.states.filter(match).map(fill_state);
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
  const builder = new Builder();
  nearley.ParserRules.forEach(
      (x: any) => builder.add(x.name, x.symbols, x.postprocess));
  return builder.build(nearley.ParserStart);
}

const path = '../../node_modules/nearley/lib/nearley-language-bootstrapped';
const grammar = make_nearley_grammar(path);

const name = 'node_modules/nearley/lib/nearley-language-bootstrapped.ne';
fs.readFile(name, {encoding: 'utf8'}, (error: Error, data: string) => {
  const start = Date.now();
  const parser = new Parser(grammar, {keep_history: true});
  Array.from(data).forEach((x) => parser.feed(x));
  const total = Date.now() - start;
  console.log(`${parser.debug()}\n\n${debug(parser.parses())}`);
  console.log(`\nTotal time: ${total}ms`);
});
