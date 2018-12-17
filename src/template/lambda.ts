import {Arguments as BA, Template as BT} from './base';
import {Lambda as Expr, Template as T} from './expr';

// Lambda is a simple wrapper around Expr that makes typing easier to read.

interface Arguments extends BA<Lambda | null> {}
interface Template extends BT<Lambda | null> {}

interface Lambda {
  expr: Expr;
  repr: string;
}

// We provide some convenience methods for converting between the two.

const unwrap = (x: Lambda): Expr => x.expr;

const unwrap_null = (x: Lambda | null): Expr | null => x && x.expr;

const wrap = (x: Expr): Lambda => ({expr: x, repr: Expr.stringify(x)});

const wrap_null = (x: Expr | null): Lambda | null => x && wrap(x);

// Helpers to convert an expression template into a lambda template.

const map_args = <S, T>(args: BA<S>, fn: (s: S) => T): BA<T> => {
  if (args instanceof Array) return args.map(fn);
  const result: BA<T> = {};
  for (const i in args) {
    // tslint:disable-next-line:forin
    result[i] = fn(args[i] as S);
  }
  return result;
};

const parse_lambda = (x: string): Lambda => wrap(Expr.parse(x));

const parse_template = (x: string): BT<Lambda | null> => {
  const base = T.parse(x);
  return {
    merge: x => wrap_null(base.merge(map_args(x, unwrap_null))),
    split: x => base.split(unwrap_null(x)).map(y => map_args(y, wrap_null)),
  };
};

// Our public APIs are the same as Exprs so Lambda is a drop-in replacement.

const Lambda = {parse: parse_lambda};

const Template = {parse: parse_template};

export {Arguments, Lambda, Template};
