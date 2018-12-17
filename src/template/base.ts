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

interface Template<T> {
  merge: (args: Arguments<T>) => T;
  split: (x: T) => Arguments<T>[];
}

// Some helpers that apply across different types of templates.

type Slot = {index: number; optional: boolean};

const cross = <T>(xs: Arguments<T>[], ys: Arguments<T>[]): Arguments<T>[] =>
  flatten(xs.map(x => ys.map(y => ({...x, ...y}))));

const reindex = <T>(slots: Slot[], template: Template<T>): Template<T> => ({
  merge: (args: Arguments<T>) => {
    const reindexed: Arguments<T> = {};
    slots.forEach((x, i) => (reindexed[i] = args[x.index]));
    return template.merge(reindexed);
  },
  split: (x: T) => {
    const dummy: Arguments<T> = {};
    const result = template.split(x);
    return result
      .map(y => {
        const keys = Object.keys(y).map(i => parseInt(i, 10));
        if (keys.some(i => i >= slots.length && y[i] !== null)) return dummy;
        if (slots.some((x, i) => !x.optional && y[i] === null)) return dummy;
        const reindexed: Arguments<T> = {};
        slots.forEach((x, i) => i in y && (reindexed[x.index] = y[i]));
        return reindexed;
      })
      .filter(y => y !== dummy);
  },
});

const Template = {cross, reindex};

export {Arguments, Slot, Template};
