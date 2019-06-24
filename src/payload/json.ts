import {flatten, nonnull, quote, range} from '../lib/base';
import {Node, Parser} from '../lib/combinators';
import {Arguments as BA, Payload, Template as BT} from './base';

interface Arguments extends BA<Json> {}
interface Template extends BT<Json> {}

type Primitive = boolean | null | number | string;
type Json = Primitive | JsonDict | JsonList;
interface JsonDict {
  [key: string]: Json;
}
interface JsonList extends Array<Json> {}

// Private implementation details of some complex templates.

type Dict = {[key: string]: Template};

type Item = {spread: false; dict: Dict} | {spread: true; template: Template};

const empty = (x: JsonDict): boolean => Object.keys(x).length === 0;

const coerce_dict = (x: Json): JsonDict => {
  if (!dict_or_null(x)) throw new Error(`Expected: dict; got: ${x}`);
  return x || {};
};

const coerce_list = (x: Json): JsonList => {
  if (!list_or_null(x)) throw new Error(`Expected: list; got: ${x}`);
  return x || [];
};

const dict_or_null = (x: Json): x is null | JsonDict =>
  x === null || typeof x === 'object';

const list_or_null = (x: Json): x is null | JsonList =>
  x === null || x instanceof Array;

const dict_to_null = (x: JsonDict): Json => (empty(x) ? null : x);

const list_to_null = (x: JsonList): Json => (x.length === 0 ? null : x);

const void_to_null = (x: Json | void): Json => (x == null ? null : x);

const concat = (a: Template, b: Template): Template => ({
  merge: (args: Arguments) => {
    return flatten([a, b].map(x => coerce_list(x.merge(args))));
  },
  split: (x: Json) => {
    const xs = coerce_list(x);
    return flatten(
      range(xs.length + 1).map(i => {
        const [ax, bx] = [xs.slice(0, i), xs.slice(i)].map(list_to_null);
        return BT.cross(a.split(ax), b.split(bx));
      }),
    );
  },
});

const map = (dict: Dict): Template => ({
  merge: (args: Arguments) => {
    const result: JsonDict = {};
    for (const key in dict) {
      /* tslint:disable-next-line:forin */
      const value = dict[key].merge(args);
      if (value !== null) result[key] = value;
    }
    return result;
  },
  split: (x: Json) => {
    const xs = coerce_dict(x);
    for (const key in xs) if (!dict[key]) return [];
    const keys = Object.keys(dict).sort();
    return keys
      .map(k => dict[k].split(void_to_null(xs[k])))
      .reduce(BT.cross, [{}]);
  },
});

const merge = (a: Template, b: Template): Template => ({
  merge: (args: Arguments) => {
    const [ax, bx] = [a, b].map(x => coerce_dict(x.merge(args)));
    return {...ax, ...bx};
  },
  split: (x: Json) => {
    const xs = coerce_dict(x);
    const keys = Object.keys(xs).sort();
    return flatten(
      /* tslint:disable-next-line:no-bitwise */
      range(1 << keys.length).map(i => {
        const items: JsonDict[] = [{}, {}];
        /* tslint:disable-next-line:no-bitwise */
        keys.forEach((k, j) => (items[(1 << j) & i ? 1 : 0][k] = xs[k]));
        const [ax, bx] = items.map(dict_to_null);
        return BT.cross(a.split(ax), b.split(bx));
      }),
    );
  },
});

const singleton = (a: Template): Template => ({
  merge: (args: Arguments) => [a.merge(args)].filter(x => x !== null),
  split: (x: Json) => {
    const xs = coerce_list(x);
    return xs.length <= 1 ? a.split(void_to_null(xs[0])) : [];
  },
});

// Specific implementations of the Template interface.

const dict = (xs: Item[]): Template => {
  const list = xs.map(x => (x.spread ? x.template : map(x.dict)));
  const base = list.reduce(merge);
  return {
    merge: (args: Arguments) => dict_to_null(coerce_dict(base.merge(args))),
    split: (x: Json) =>
      dict_or_null(x) && !(x && empty(x)) ? base.split(x) : [],
  };
};

const list = (xs: {spread: boolean; template: Template}[]): Template => {
  const list = xs.map(x => (x.spread ? x.template : singleton(x.template)));
  const base = list.reduce(concat);
  return {
    merge: (args: Arguments) => list_to_null(coerce_list(base.merge(args))),
    split: (x: Json) =>
      list_or_null(x) && !(x && x.length === 0) ? base.split(x) : [],
  };
};

const primitive = (value: Primitive): Template => ({
  merge: (args: Arguments) => value,
  split: (x: Json) => (x === value ? [{}] : []),
});

const variable = (index: number): Template => ({
  merge: (args: Arguments) => void_to_null(args[index]),
  split: (x: Json) => [{[index]: x}],
});

// Helpers needed to parse a template.

// prettier-ignore
const parser: Node<Template> = (() => {
  const ws = Parser.regexp(/\s*/m);
  const id = Parser.regexp(/[a-zA-Z_]+/).skip(ws);
  const w = (x: string) => Parser.string(x).skip(ws);
  const index = Parser.regexp(/[0-9]+/).skip(ws).map(x => parseInt(x, 10));

  const k = (x: Primitive) => w(JSON.stringify(x)).map(y => x);
  const keyword = Parser.any(...[true, false, null].map(k)).skip(ws);

  const number = Parser.any(
    Parser.regexp(/-?(?:[0-9]|[1-9][0-9]+)?(?:\.[0-9]+)\b/).map(parseFloat),
    Parser.regexp(/-?(?:[0-9]|[1-9][0-9]+)\b/).map(parseInt),
  ).skip(ws);

  const string = Parser.any(
    Parser.regexp(/"[^"]*"/).map(x => JSON.parse(x) as string),
    Parser.regexp(/'[^']*'/).map(x => JSON.parse(quote(x)) as string),
  ).skip(ws);

  const spread = Parser.all(w('...$'), number).map(
    x => ({spread: true as true, template: variable(x[1])}));

  // Helpers needed to parse a dict.
  const key = Parser.any(id, string);
  const value = Parser.lazy(() => parser);
  const dict_item = Parser.all(key, w(':'), value).repeat(1, w(',')).map(x => {
    const dict = x.reduce((acc, y) => ({...acc, [y[0]]: y[2]}), {} as Dict);
    return {spread: false, dict} as Item;
  });
  const dict_items = Parser.any(dict_item, spread).repeat(0, w(','));

  // Helpers needed to parse a list.
  const list_item = value.map(x => ({spread: false, template: x}));
  const list_items = Parser.any(list_item, spread).repeat(0, w(','));

  // Our final parser return value.
  return ws.then(Parser.any(
    w('[').then(list_items).skip(w(']')).map(list),
    w('{').then(dict_items).skip(w('}')).map(dict),
    Parser.any(keyword, number, string).map(primitive),
    w('$').then(number).map(variable),
  ));
})();

// The DataType type class implementation for this type.

const Json: Payload<Json> = {
  is_base: x => (typeof x === 'string' ? x : null),
  is_null: x => x === null,
  make_base: x => x,
  make_null: () => null,
  parse: x => parser.parse(x).merge([]),
  stringify: JSON.stringify,
  template: x => parser.parse(x),
};

export {Json};
