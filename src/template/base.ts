import {flatten} from '../lib/base';

// A template is an "invertible function" on a type T:
//
//  - Given an assignment of input args of type T, "merge" outputs a T.
//    Some of the inputs may be missing - they are treated specially.
//
//  - Given an output T, "split" returns a list of possible input assignments
//    that would cause "merge" to return that output. This list may be empty.

interface Arguments<T> {
  [i: number]: T | void;
}

interface DataType<T> {
  is_base: (x: T) => string | null;
  is_null: (x: T) => boolean;
  make_base: (x: string) => T;
  make_null: () => T;
  parse: (x: string) => T;
  stringify: (x: T) => string;
  template: (x: string) => Template<T>;
}

interface Template<T> {
  merge: (args: Arguments<T>) => T;
  split: (x: T) => Arguments<T>[];
}

// Some helpers that apply across different types of templates.

type Slot = {index: number; optional: boolean};

const cross = <T>(xs: Arguments<T>[], ys: Arguments<T>[]): Arguments<T>[] =>
  flatten(xs.map(x => ys.map(y => ({...x, ...y}))));

const reindex = <T>(
  data_type: DataType<T>,
  slots: Slot[],
  template: Template<T>,
): Template<T> => ({
  merge: (args: Arguments<T>) => {
    const reindexed: Arguments<T> = {};
    slots.forEach((x, i) => (reindexed[i] = args[x.index]));
    return template.merge(reindexed);
  },
  split: (x: T) => {
    const base = template.split(x);
    const check = slots.map(x => x.index >= 0);
    const dummy: Arguments<T> = {};
    const empty = (x: T | void) => x !== void 0 && data_type.is_null(x);
    return base
      .map(y => {
        const keys = Object.keys(y).map(i => parseInt(i, 10));
        if (keys.some(i => !check[i] && !empty(y[i]))) return dummy;
        if (slots.some((x, i) => !x.optional && empty(y[i]))) return dummy;
        const result: Arguments<T> = {};
        slots.forEach((x, i) => i in y && check[i] && (result[x.index] = y[i]));
        return result;
      })
      .filter(y => y !== dummy);
  },
});

const Template = {cross, reindex};

export {Arguments, DataType, Slot, Template};
