import {Option, assert, flatten, nonnull, quote, range} from '../lib/base';
import {Node, Parser} from '../lib/combinators';
import {Arguments, DataType, Slot, Template} from '../template/base';
import {Tense, Term, Tree, XGrammar, XLexer, XRule} from './extensions';

interface Macro {
  args: string[];
  rules: Rule[];
}

interface Rule {
  fn?: string;
  merge?: number;
  split?: number;
  rhs: RHS[];
  tense?: Tense;
}

interface RHS {
  expr: Expr;
  index?: number;
  optional: boolean;
  mark?: '^' | '*';
}

interface State<T> {
  bindings: Map<string, Term>;
  data_type: DataType<T>;
  grammar: XGrammar<T, 0>;
  macros: Map<string, Macro>;
  symbols: Set<string>;
}

interface Transform<T> {
  merge: XRule<T, 0>['merge']['fn'];
  split: XRule<T, 0>['split']['fn'];
}

type LHS =
  | {type: 'macro'; macro: string; args: string}
  | {type: 'name'; name: string};

type Expr =
  | {type: 'binding'; name: string}
  | {type: 'macro'; name: string; args: Expr[]}
  | {type: 'term'; term: Term};

type Update =
  | {type: 'lexer'; lexer: string}
  | {type: 'macro'; name: string; macro: Macro}
  | {type: 'rules'; lhs: string; root: boolean; rules: Rule[]};

// Simple helpers for the methods below.

const kRootSymbol = '$Root';

const kSignData = {'<': {split: -Infinity}, '>': {merge: -Infinity}, '=': {}};

const coalesce = <T>(dt: DataType<T>, value: T | void): T =>
  value == null ? dt.make_null() : value;

// TODO(skishore): We're using an optimization here by trying to mark slots
// as required unless they're explicitly flagged as optional with a ? mark.
// This optimization doesn't quite work, because terms without a ? can still
// by null by having a NONE rule without provided semantics, or by parsing to
// a raw term without semantics.
//
// We can replace this optimization with much better ones, such as caching the
// split value of the base template. Many rules have a single template shared
// across all their RHS values, just with differences in slot indices.
const get_slots = (rhs: RHS[]): Slot[] => {
  const marked = [];
  for (let i = 0; i < rhs.length; i++) {
    const {index, optional} = rhs[i];
    if (index != null) marked.push({new: index, old: i, optional});
  }
  if (marked.length === 0) return rhs.map((x, i) => ({...x, index: i}));
  const n = Math.max(...marked.map(x => x.new));
  const result = range(n + 1).map(i => ({index: -1, optional: true}));
  marked.map(x => (result[x.new] = {index: x.old, optional: x.optional}));
  return result;
};

const lift_template = <T>(n: number, template: Template<T>): Transform<T> => ({
  merge: (x: T[]) => template.merge(x),
  split: (x: Option<T>) => {
    const y = x ? template.split(x.some) : [{}];
    return y.map(x => range(n).map(i => (i in x ? {some: x[i] as T} : null)));
  },
});

const make_template = <T>(dt: DataType<T>, rule: Rule) => {
  const fn = rule.fn;
  const slots = get_slots(rule.rhs);
  const template = fn ? dt.template(fn) : null_template(dt, slots.length);
  return Template.reindex(dt, slots, template);
};

const null_template = <T>(dt: DataType<T>, n: number): Template<T> => ({
  merge: x => dt.make_null(),
  split: x => (dt.is_null(x) ? [{}] : []),
});

const unit_template = <T>(dt: DataType<T>): Template<T> => ({
  merge: x => coalesce(dt, x[0]),
  split: x => [[x]],
});

// Helpers to create a single term, which involves expanding macros.

const build_binding = <T>(arg: string, state: State<T>): Term => {
  const result = state.bindings.get(arg);
  if (!result) throw Error(`Unbound macro argument: ${arg}`);
  return result;
};

const build_expr = <T>(expr: Expr, state: State<T>): Term => {
  if (expr.type === 'binding') return build_binding(expr.name, state);
  if (expr.type === 'macro') return build_macro(expr.args, expr.name, state);
  return expr.term;
};

const build_macro = <T>(args: Expr[], name: string, state: State<T>): Term => {
  // Compute a symbol for the macro given these arguments.
  const macro = state.macros.get(name);
  if (!macro) throw Error(`Unbound macro: ${name}`);
  const n = macro.args.length;
  if (args.length !== n) {
    throw Error(`${name} got ${args.length} argments; expected: ${n}`);
  }
  const terms = args.map(x => build_expr(x, state));
  const symbol = `${name}[${terms.map(x => x.name).join(', ')}]`;
  const term = {name: symbol, terminal: false};
  if (state.symbols.has(symbol)) return term;

  // Add rules needed for this new macro instantiation.
  const child: State<T> = {...state, bindings: new Map()};
  terms.forEach((x, i) => child.bindings.set(macro.args[i], x));
  process_rules(symbol, macro.rules, child);
  return term;
};

const build_option = <T>(term: Term, state: State<T>): Term => {
  const name = `${term.name}?`;
  if (!state.symbols.has(name)) {
    state.symbols.add(name);
    for (const rhs of [[], [term]]) {
      state.grammar.rules.push(get_rule(state.data_type, name, rhs));
    }
  }
  return {name, terminal: false};
};

const build_term = <T>(rhs: RHS, state: State<T>): Term => {
  const base = build_expr(rhs.expr, state);
  return rhs.optional ? build_option(base, state) : base;
};

const get_fns = <T>(rule: Partial<Rule>, transform: Transform<T>) => ({
  merge: {fn: transform.merge, score: rule.merge || 0},
  split: {fn: transform.split, score: rule.split || 0},
});

const get_precedence = (rhs: RHS[]): number[] => {
  const result: number[] = [];
  rhs.forEach((x, i) => (x.mark === '*' ? result.push(i) : null));
  rhs.forEach((x, i) => (x.mark === '^' ? result.push(i) : null));
  return result.length === 0 ? range(rhs.length) : result;
};

const get_rule = <T>(dt: DataType<T>, l: string, r: Term[]): XRule<T, 0> => {
  const n = r.length;
  const data = {precedence: range(n), tense: {}};
  const template = n === 1 ? unit_template(dt) : null_template(dt, n);
  return {data, lhs: l, rhs: r, ...get_fns({}, lift_template(n, template))};
};

// Helpers methods to apply the various types of updates.

const process_lexer = <T>(lexer: string, state: State<T>) => {
  // tslint:disable-next-line:no-eval
  state.grammar.lexer = nonnull(eval(`() => {${lexer}}`)());
};

const process_macro = <T>(name: string, macro: Macro, state: State<T>) => {
  if (state.macros.has(name)) throw Error(`Duplicate macro: ${name}`);
  state.macros.set(name, macro);
};

const process_rules = <T>(lhs: string, rules: Rule[], state: State<T>) => {
  if (state.symbols.has(lhs)) throw Error(`Duplicate symbol: ${lhs}`);
  state.symbols.add(lhs);
  for (const rule of rules) {
    const precedence = get_precedence(rule.rhs);
    const data = {precedence, tense: rule.tense || {}};
    const rhs = rule.rhs.map(x => build_term(x, state));
    const template = make_template(state.data_type, rule);
    const transform = lift_template(rule.rhs.length, template);
    state.grammar.rules.push({data, lhs, rhs, ...get_fns(rule, transform)});
  }
};

const process_start = <T>(name: string, state: State<T>) => {
  const dt = state.data_type;
  const rhs = [{name, terminal: false}];
  state.grammar.rules.push(get_rule(dt, kRootSymbol, rhs));
};

// Parsers for our grammar term DSL.

// prettier-ignore
const parser = (() => {
  const comment = Parser.regexp(/#.*/);
  const ws = Parser.regexp(/\s*/m).repeat(0, comment);
  const id = Parser.regexp(/[a-zA-Z_]+/);
  const st = <T extends string>(x: T) => Parser.string(x) as Node<T>;
  const maybe = <T>(x: Node<T | null>) => x.or(Parser.succeed(null));
  const prefix = (x: string) => st(x).then(id).map(y => `${x}${y}`);
  const [binding, symbol, terminal] = Array.from('@$%').map(prefix);

  // Number and string literals.
  const index = Parser.regexp(/[0-9]+/).map(parseInt);
  const number = Parser.any(
    Parser.regexp(/-?(?:[0-9]|[1-9][0-9]+)?(?:\.[0-9]+)\b/).map(parseFloat),
    Parser.regexp(/-?(?:[0-9]|[1-9][0-9]+)\b/).map(parseInt),
  );
  const string = Parser.any(
    Parser.regexp(/"[^"]*"/).map(x => JSON.parse(x) as string),
    Parser.regexp(/'[^']*'/).map(x => JSON.parse(quote(x)) as string),
  );

  // Helpers for parsing macro argument lists.
  const commas = <T>(x: Node<T>) => x.repeat(1, ws.skip(st(',')).skip(ws));
  const args = <T>(x: Node<T>) => st('[').then(commas(x)).skip(st(']'));
  const macro = id.and(args(binding));

  // Parsers for binding, macro, or term expressions which appear on the RHS.
  const term: Node<Term> = Parser.any(
    symbol.map(x => ({name: x, terminal: false})),
    id.map(x => ({name: x, terminal: true})),
    terminal.map(x => ({name: x, terminal: true})),
  );
  const expr: Node<Expr> = Parser.any(
    binding.map(x => ({type: 'binding', name: x} as Expr)),
    id.and(args(Parser.lazy(() => expr))).map(
      x => ({type: 'macro', name: x[0], args: x[1]} as Expr)),
    term.map(x => ({type: 'term', term: x} as Expr)),
  );

  // A parser for an RHS item, a marked-up expression.
  const item = Parser.all(
    expr,
    maybe(st(':').then(number)),
    maybe(st('?')),
    maybe(Parser.any(st('^'), st('*'))),
  ).map<RHS>(x => {
    const index = x[1] === null ? void 0 : x[1];
    const mark = x[3] === null ? void 0 : x[3];
    return {expr: x[0], index, optional: !!x[2], mark};
  });

  // A parser for a rule's associated data.
  const tense = id.skip(ws).and(id).map(x => ({[x[0]]: x[1]}));
  const entry = Parser.any<Partial<Rule>>(
    Parser.string('=').then(ws).then(string).map(x => ({fn: x})),
    Parser.string('<').then(ws).then(number).map(x => ({merge: x})),
    Parser.string('>').then(ws).then(number).map(x => ({split: x})),
    Parser.string('?').then(ws).then(tense).map(x => ({tense: x})),
  );
  const tuple = Parser.string('(').then(entry).skip(Parser.string(')'));
  const data = tuple.repeat(0, ws).map(xs => xs.reduce(
    (acc, x) => ({...acc, ...x, tense: {...acc.tense, ...x.tense}}), {}));

  // A parser for a complete list of RHS options for a macro or rule.
  const none = st('NONE').map(() => []);
  const sign = Parser.any(st('<'), st('='), st('>'));
  const list = Parser.any(none, item.repeat(1, Parser.string(' ')));
  const side = sign.skip(ws).and(list).skip(ws).and(data);
  const rule = data.skip(ws).and(side.repeat(1, ws)).map(x => {
    const [base_data, rules] = x;
    return rules.map(y => {
      const [[sign, rhs], rule_data] = y;
      return {...base_data, ...rule_data, ...kSignData[sign], rhs} as Rule;
    });
  });

  // Our top-level parser parses a list of lexer, macro, or rules updates.
  const update = Parser.any<Update>(
    Parser.regexp(/lexer: ```[\s\S]*```/).map(
      x => ({type: 'lexer', lexer: x.slice(11, -3)} as Update)),
    macro.skip(ws).and(rule).map(
      x => ({type: 'macro', name: x[0][0], macro: {args: x[0][1], rules: x[1]}} as Update)),
    symbol.and(maybe(st('!'))).skip(ws).and(rule).map(
      x => ({type: 'rules', lhs: x[0][0], root: !!x[0][1], rules: x[1]} as Update)),
  );
  return ws.then(update.repeat(1, ws)).skip(ws);
})();

// Our public interface includes two main methods for creating grammars.

const parse = <T>(data_type: DataType<T>, input: string): XGrammar<T> => {
  // tslint:disable-next-line:no-any
  const lexer: XLexer<T, 0> = null as any;
  const state: State<T> = {
    bindings: new Map(),
    data_type,
    grammar: {
      key: x => (x ? `Some(${state.data_type.stringify(x.some)})` : 'None'),
      lexer,
      rules: [],
      start: kRootSymbol,
    },
    macros: new Map(),
    symbols: new Set(),
  };

  // Sort the grammar objects by their type.
  const updates = parser.parse(input);
  const lexers: {lexer: string}[] = [];
  const macros: {name: string; macro: Macro}[] = [];
  const symbol: {lhs: string; root: boolean; rules: Rule[]}[] = [];
  updates.forEach(x => {
    if (x.type === 'lexer') lexers.push(x);
    if (x.type === 'macro') macros.push(x);
    if (x.type === 'rules') symbol.push(x);
  });
  if (lexers.length === 0) throw Error('Unable to find lexer block!');

  // Apply the different types in order.
  lexers.forEach(x => process_lexer(x.lexer, state));
  macros.forEach(x => process_macro(x.name, x.macro, state));
  symbol.forEach(x => process_rules(x.lhs, x.rules, state));
  symbol.forEach(x => x.root && process_start(x.lhs, state));
  return validate(Tree.lift(state.grammar));
};

const validate = <T>(grammar: XGrammar<T>): XGrammar<T> => {
  // Collect all the symbol, text, and type terms in this grammar.
  const lhs = new Set<string>();
  const rhs = new Set<string>([grammar.start]);
  const terminals = new Set<string>();
  grammar.rules.forEach(x => {
    lhs.add(x.lhs);
    x.rhs.forEach(y => (y.terminal ? terminals : rhs).add(y.name));
  });

  // Check reachability. If a symbol is LHS- or RHS-only, it must be a typo.
  const dead_end = Array.from(rhs).filter(x => !lhs.has(x));
  const unreachable = Array.from(lhs).filter(x => !rhs.has(x));
  if (dead_end.length > 0) {
    throw Error(`Dead-end symbols: ${dead_end.sort().join(', ')}`);
  } else if (unreachable.length > 0) {
    throw Error(`Unreachable symbols: ${unreachable.sort().join(', ')}`);
  }

  // Check that all terminals are known to the lexer.
  const unknown = (x: string) => grammar.lexer.unlex(x, null).length === 0;
  const unknown_terms = Array.from(terminals).filter(unknown);
  if (unknown_terms.length > 0) {
    throw Error(`Unknown terms: ${unknown_terms.join(', ')}`);
  }
  return grammar;
};

const Fantasy = {parse, validate};

export {Fantasy};

// A quick test of the interface above.

declare const require: any;
import {debug, RNG} from '../lib/base';
import {Lambda} from '../template/lambda';
import {Corrector} from './corrector';
import {Generator} from './generator';
import {Parser as P} from './parser';

const fs = require('fs');
const input = fs.readFileSync('src/hindi/hindi.gr', 'utf8');
const grammar = Fantasy.parse(Lambda, input);

/* tslint:disable:no-console */
declare const process: any;
const last = process.argv[2];
const text = process.argv.slice(3).join(' ');
const generate = last === 'generate';
if (last !== 'generate' && last !== 'parse') {
  console.error('Usage: ./fantasy.ts [generate|parse]');
  process.exit(1);
}

const time = Date.now();
for (let i = 0; i < 100000; i++) {
  const rng = new RNG();
  const maybe = generate
    ? Generator.generate(grammar, rng, {some: Lambda.parse(text)})
    : P.parse(grammar, text);
  if (!maybe) throw new Error(`Failed to ${last} input!`);
  const tree = nonnull(maybe).some;
}
console.log(Date.now() - time);
