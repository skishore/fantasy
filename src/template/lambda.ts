import {Arguments as BA, DataType, Template as BT} from './base';
import {Lambda as Expr} from './expr';

// Lambda is a simple wrapper around Expr that makes typing easier to read.

interface Arguments extends BA<Lambda | null> {}
interface Template extends BT<Lambda | null> {}

interface Lambda {
  expr: Expr;
  repr: string;
}

// We provide some convenience methods for converting between the two.

const unwrap = (x: Lambda | null): Expr | null => x && x.expr;

const wrap = (x: Expr | null) => x && {expr: x, repr: Expr.stringify(x)};

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

const template = (x: string): BT<Lambda | null> => {
  const base = Expr.template(x);
  return {
    merge: x => wrap(base.merge(map_args(x, unwrap))),
    split: x => base.split(unwrap(x)).map(y => map_args(y, wrap)),
  };
};

// The DataType type class implementation for this type.

const Lambda: DataType<Lambda | null> = {
  is_base: x => Expr.is_base(unwrap(x)),
  is_null: x => Expr.is_null(unwrap(x)),
  make_base: x => wrap(Expr.make_base(x)),
  make_null: () => wrap(Expr.make_null()),
  parse: x => wrap(Expr.parse(x)),
  stringify: x => (x === null ? '-' : x.repr),
  template,
};

export {Lambda};
