import {Option, assert, flatten, nonnull, quote, range} from '../lib/base';
import {Node, Parser} from '../lib/combinators';
import {Arguments, DataType, Slot, Template} from '../template/base';
import {Tense, Term, Tree, XGrammar, XLexer, XRule} from './extensions';

type Data = {fn?: string; merge?: number; split?: number; tense?: Tense};

type Item = {index?: number; optional: boolean; mark?: '^' | '*'; term: Term};

type Rule = {data: Data; lhs: string; rhs: Item[]};

type Update =
  | {type: 'base'; config: string}
  | {type: 'root'; symbol: string}
  | {type: 'rule'; rule: Rule};

interface State<T> {
  data_type: DataType<T>;
  optionals: {[name: string]: boolean};
  lexer: XLexer<T, 0>;
  rules: XRule<T, 0>[];
}

interface Transform<T> {
  merge: XRule<T, 0>['merge']['fn'];
  split: XRule<T, 0>['split']['fn'];
}

// Simple helpers for the methods below.

const kRootSymbol = '$Root';

const kSignData = {'<': {split: -Infinity}, '>': {merge: -Infinity}, '=': {}};

const coalesce = <T>(dt: DataType<T>, value: T | void): T =>
  value == null ? dt.make_null() : value;

const get_slots = (rhs: Item[]): Slot[] => {
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
  const fn = rule.data.fn;
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

// Helpers to construct a grammar as we parse its input spec.

const make = <T>(dt: DataType<T>, lhs: string, rhs: Term[]): XRule<T, 0> => {
  const n = rhs.length;
  const data = {precedence: range(n), tense: {}};
  const template = n === 1 ? unit_template(dt) : null_template(dt, n);
  return {data, lhs, rhs: rhs, ...make_fns({}, lift_template(n, template))};
};

const make_base = <T>(config: string, state: State<T>) => {
  // tslint:disable-next-line:no-eval
  state.lexer = nonnull(eval(`() => {${config}}`)());
};

const make_fns = <T>(data: Data, transform: Transform<T>) => ({
  merge: {fn: transform.merge, score: data.merge || 0},
  split: {fn: transform.split, score: data.split || 0},
});

const make_precedence = (rhs: Item[]): number[] => {
  const result: number[] = [];
  rhs.forEach((x, i) => (x.mark === '*' ? result.push(i) : null));
  rhs.forEach((x, i) => (x.mark === '^' ? result.push(i) : null));
  return result.length === 0 ? range(rhs.length) : result;
};

const make_root = <T>(name: string, state: State<T>) => {
  const dt = state.data_type;
  state.rules.push(make(dt, kRootSymbol, [{name, terminal: false}]));
};

const make_rule = <T>(rule: Rule, state: State<T>) => {
  const tense = rule.data.tense || {};
  const data = {precedence: make_precedence(rule.rhs), tense};
  const lhs = rule.lhs;
  const rhs = rule.rhs.map(x => make_term(x, state));
  const template = make_template(state.data_type, rule);
  const transform = lift_template(rule.rhs.length, template);
  state.rules.push({data, lhs, rhs, ...make_fns(rule.data, transform)});
};

const make_term = <T>(item: Item, state: State<T>): Term => {
  if (!item.optional) return item.term;
  const name = `${item.term.name}?`;
  if (!state.optionals[name]) {
    const dt = state.data_type;
    [[], [item.term]].map(x => state.rules.push(make(dt, name, x)));
    state.optionals[name] = true;
  }
  return {name, terminal: false};
};

// Parsers for our grammar term DSL.

// prettier-ignore
const parser = (() => {
  const comment = Parser.regexp(/#.*/);
  const ws = Parser.regexp(/\s*/m).repeat(0, comment);
  const id = Parser.regexp(/[a-zA-Z_]+/);
  const symbol = Parser.string('$').then(id).map(x => `$${x}`);
  const maybe = <T>(x: Node<T | null>) => x.or(Parser.succeed(null));
  const literal = <T extends string>(x: T) => Parser.string(x) as Node<T>;

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

  // A base parser for a name, text, or type term.
  const term = Parser.any(
    symbol.map(x => ({name: x, terminal: false})),
    id.map(x => ({name: x, terminal: true})),
    Parser.string('%').then(id).map(x => ({name: `%${x}`, terminal: true})),
  );

  // A parser for an RHS item, which is a term with its associated data.
  const item = Parser.all(
    term,
    maybe(Parser.string(':').then(number)),
    maybe(Parser.string('?')),
    maybe(Parser.any(literal('^'), literal('*'))),
  ).map<Item>(x => {
    const index = x[1] === null ? void 0 : x[1];
    const mark = x[3] === null ? void 0 : x[3];
    return {index, optional: !!x[2], mark, term: x[0]};
  });

  // A parser for a rule's associated data.
  const tense = id.skip(ws).and(id).map(x => ({[x[0]]: x[1]}));
  const entry = Parser.any<Data>(
    Parser.string('=').then(ws).then(string).map(x => ({fn: x})),
    Parser.string('<').then(ws).then(number).map(x => ({merge: x})),
    Parser.string('>').then(ws).then(number).map(x => ({split: x})),
    Parser.string('?').then(ws).then(tense).map(x => ({tense: x})),
  );
  const tuple = Parser.string('(').then(entry).skip(Parser.string(')'));
  const data = tuple.repeat(0, ws).map(
    xs => xs.reduce((acc, x) => ({...acc, ...x, tense: {...acc.tense, ...x.tense}}), {}));

  // Parsers for a symbol along with its rules.
  const sign = Parser.any(literal('<'), literal('='), literal('>'));
  const lhs = Parser.all(symbol, maybe(literal('!')));
  const rhs = sign.skip(ws).and(item.repeat(1, Parser.string(' ')));
  const side = rhs.skip(ws).and(data).repeat(1, ws);
  const rule = lhs.skip(ws).and(data).skip(ws).and(side).map(x => {
    const result: Update[] = [];
    const [[lhs, root], base_data] = x[0];
    if (root) result.push({type: 'root', symbol: lhs});
    x[1].map(y => {
      const [[sign, rhs], rule_data] = y;
      const data = {...base_data, ...rule_data, ...kSignData[sign]};
      result.push({type: 'rule', rule: {data, lhs, rhs}});
    });
    return result;
  });

  // Parsers for a lexer and a complete grammar.
  const text = Parser.regexp(/lexer: ```[\s\S]*```/).map(
    x => [{type: 'base', config: x.slice(11, -3)} as Update]);
  return ws.then(Parser.any(rule, text).repeat(1, ws)).skip(ws).map(flatten);
})();

// Our public interface includes two main methods for creating grammars.

const parse = <T>(data_type: DataType<T>, input: string): XGrammar<T> => {
  // tslint:disable-next-line:no-any
  const lexer: XLexer<T, 0> = null as any;
  const state: State<T> = {data_type, optionals: {}, lexer, rules: []};
  const updates = parser.parse(input);
  updates.map(x => {
    if (x.type === 'base') make_base(x.config, state);
  });
  if (!state.lexer) Error('Unable to find lexer block!');
  updates.map(x => {
    if (x.type === 'root') make_root(x.symbol, state);
    if (x.type === 'rule') make_rule(x.rule, state);
  });

  const grammar: XGrammar<T, 0> = {
    key: x => (x ? `Some(${state.data_type.stringify(x.some)})` : 'None'),
    lexer: state.lexer,
    rules: state.rules,
    start: kRootSymbol,
  };
  return validate(Tree.lift(grammar));
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

const rng = new RNG();
const maybe = generate
  ? Generator.generate(grammar, rng, {some: Lambda.parse(text)})
  : P.parse(grammar, text, {debug: true});
if (!maybe) throw new Error(`Failed to ${last} input!`);
const tree = nonnull(maybe).some;
const result = Corrector.correct(grammar, rng, tree);

const print = <T>(tree: Tree<T>, script: string) =>
  Tree.matches(tree)
    .map(x => x.data.text[script])
    .join(' ');

const script = 'latin';
console.log(Tree.print(tree, script));
console.log();
console.log(Lambda.stringify(tree.value));
console.log();
console.log(`Start: ${print(tree, script)}`);
console.log(`Fixed: ${print(result.tree, script)}`);
result.diff.forEach(x => {
  if (x.type === 'right') return;
  const o = x.old.map(x => x.data.text[script]).join(' ');
  const n = x.new.map(x => x.data.text[script]).join(' ');
  console.log(`${o} -> ${n}:\n  ${x.errors.join('\n  ')}`);
});
