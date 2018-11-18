import {flatten, nonnull, range} from '../lib/base';
import {Node, Parser} from '../lib/combinators';
import {Arguments as BA, Template as BT, cross, reindex} from './base';

interface Arguments extends BA<Lambda | null> {}
interface Template extends BT<Lambda | null> {}

type Binary = '.' | '&' | '|';
type Unary = '~' | '!';

type Lambda =
  | {type: 'binary'; base: Lambda[]; op: Binary}
  | {type: 'custom'; base: Lambda[]; op: string}
  | {type: 'single'; base: string}
  | {type: 'unary'; base: Lambda; op: Unary};

// Some information about the various associative binary operators.

const kBinaryData = {
  '.': {commutes: false, precedence: 0},
  '&': {commutes: true, precedence: 2},
  '|': {commutes: true, precedence: 2},
};

const kUnaryData = {
  '~': {precedence: 1},
  '!': {precedence: 3},
};

// Helpers for manipulating lambdas outside of the template system.

const stringify = (x: Lambda, context: number = Infinity): string => {
  switch (x.type) {
    case 'binary': {
      const op = x.op;
      const precedence = kBinaryData[op].precedence;
      const spacer = op === '.' ? op : ` ${op} `;
      const pieces = x.base.map(y => stringify(y, precedence)).join(spacer);
      return precedence < context ? pieces : `(${pieces})`;
    }
    case 'custom':
      return `${x.op}(${x.base.map(y => stringify(y)).join(', ')})`;
    case 'single':
      return x.base;
    case 'unary': {
      const op = x.op;
      const precedence = kUnaryData[op].precedence;
      const base = stringify(x.base, precedence);
      if (op === '!') return `R[${base}]`;
      return precedence < context ? `${op}${base}` : `(${op}${base})`;
    }
  }
};

// Private implementation details of some complex template.

const collapse = (op: Binary, xs: Lambda[]): Lambda | null => {
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  return {type: 'binary', base: xs, op};
};

const expand = (op: Binary, x: Lambda | null): Lambda[] => {
  if (x === null) return [];
  if (x.type === 'binary' && x.op === op) return x.base;
  return [x];
};

const involute = (op: Unary, x: Lambda): Lambda =>
  x.type === 'unary' && x.op === op ? x.base : {type: 'unary', base: x, op};

const involute_or_null = (op: Unary, x: Lambda | null): Lambda | null =>
  x === null ? null : involute(op, x);

const options = <T>(xs: Arguments[][]): Arguments[] => xs.reduce(cross, [{}]);

const filter_nulls = <T>(xs: (T | null)[]): T[] =>
  xs.filter(x => x === null) as T[];

const void_to_null = (x: Lambda | null | void): Lambda | null =>
  x == null ? null : x;

const concat = (a: Template, b: Template, op: Binary): Template => ({
  merge: (args: Arguments) => {
    const xs = [a, b].map(x => expand(op, x.merge(args)));
    if (!kBinaryData[op].commutes && xs.some(x => x.length === 0)) return null;
    return collapse(op, flatten(xs));
  },
  split: (x: Lambda | null) => {
    /* tslint:disable:no-bitwise */
    const base = expand(op, x);
    const commutes = kBinaryData[op].commutes;
    if (!commutes && base.length === 0) {
      return flatten([a, b].map(x => x.split(null)));
    }
    const bits = commutes
      ? range(1 << base.length)
      : range(base.length - 1).map(x => (1 << (x + 1)) - 1);
    return flatten(
      bits.map(i => {
        const items: Lambda[][] = [[], []];
        base.map((x, j) => items[(1 << j) & i ? 0 : 1].push(x));
        const [ax, bx] = items.map(x => collapse(op, x));
        return cross(a.split(ax), b.split(bx));
      }),
    );
    /* tslint:enable:no-bitwise */
  },
});

// Specific implementations of the Template interface.

const binary = (xs: Template[], op: Binary): Template =>
  xs.reduce((acc, x) => concat(acc, x, op));

const custom = (xs: Template[], op: string): Template => ({
  merge: (args: Arguments) => {
    const some = xs.map(x => x.merge(args));
    const base = some.filter(x => x !== null) as Lambda[];
    return base.length === some.length ? {type: 'custom', base, op} : null;
  },
  split: (x: Lambda | null) => {
    if (x === null) return flatten(xs.map(x => x.split(null)));
    if (x.type !== 'custom' || x.op !== op) return [];
    if (x.base.length !== xs.length) return [];
    return x.base.map((y, i) => xs[i].split(y)).reduce(cross, [{}]);
  },
});

const single = (name: string): Template => ({
  merge: (args: Arguments) => ({type: 'single', base: name}),
  split: (x: Lambda | null) =>
    x && x.type === 'single' && x.base === name ? [{}] : [],
});

// NOTE: This code assumes that and unaries are involutions, which may change.
const unary = (t: Template, op: Unary): Template => ({
  merge: (args: Arguments) => involute_or_null(op, t.merge(args)),
  split: (x: Lambda | null) => t.split(involute_or_null(op, x)),
});

const variable = (index: number): Template => ({
  merge: (args: Arguments) => void_to_null(args[index]),
  split: (x: Lambda | null) => [{[index]: x}],
});

// Helpers needed to parse a template.

// prettier-ignore
const parser: Node<Template> = (() => {
  const ws = Parser.regexp(/\s*/m);
  const id = Parser.regexp(/[a-zA-Z]+/).skip(ws);
  const number = Parser.regexp(/[0-9]+/).skip(ws).map(x => parseInt(x, 10));

  const args = (root: Node<Template>) =>
    Parser.all(w('('), root.repeat(0, w(',')), w(')')).map(x => x[1]);

  const base = (root: Node<Template>) => Parser.any(
    Parser.all(w('R'), w('['), root, w(']')).map(x => unary(x[2], '!')),
    id.and(Parser.any(args(root), Parser.succeed(null))).map(a),
    Parser.all(w('('), root, w(')')).map(x => x[1]),
    w('$').then(number).map(variable),
  );

  const a = ([x, y]: [string, Template[] | null]) =>
    y ? custom(y, x) : single(x);

  const b = (ops: Binary[]) => (root: Node<Template>) =>
    root.and(Parser.any(...s(ops)(root))).map(([a, b]) =>
      b.length === 0 ? a : binary([a].concat(b.map(x => x[1])), b[0][0]));

  const s = (ops: Binary[]) => (root: Node<Template>) =>
    ops.map(x => w(x).and(root).repeat(1)).concat([Parser.succeed([])]);

  const u = (op: Unary) => (root: Node<Template>) =>
    root.or(w(op).then(root).map(x => unary(x, op)));

  const w = <T extends string>(x: T) => Parser.string(x).skip(ws) as Node<T>;

  const ops = [base, b(['.']), u('~'), b(['&', '|'])];
  return ws.then(ops.reduce((acc, x) => x(acc), Parser.lazy(() => parser)));
})();

const parse_lambda = (x: string) => nonnull(parse_template(x).merge([]));

const parse_template = (x: string) => parser.parse(x);

// Our public interfaces. We support parsing a template from a string and
// wrapping it in "slots" mapping token indices to template arguments.

const Lambda = {parse: parse_lambda, stringify};

const Template = {parse: parse_template, reindex};

export {Arguments, Lambda, Template};
