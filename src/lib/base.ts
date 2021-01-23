import {RNG} from './rng';

// tslint:disable-next-line:no-any
declare const require: any;
const util = require('util');

type Option<T> = Some<T> | null;

interface Some<T> {
  some: T;
}

const assert = (condition: boolean, message?: () => string): void => {
  if (!condition) throw Error(message ? message() : undefined);
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const debug = <T>(value: T): string =>
  util.inspect(value, {breakLength: Infinity, colors: true, depth: null});

const flatten = <T>(xss: T[][]): T[] => {
  const result: T[] = [];
  xss.forEach(xs => xs.forEach(x => result.push(x)));
  return result;
};

// tslint:disable-next-line:no-any
const nonnull = <T>(x: T | null): T => (assert(x !== null) as any) || x!;

const quote = (x: string): string =>
  x.replace(/[\'\"]/g, y => (y === '"' ? "'" : '"'));

const sample = <T>(xs: T[]): T => {
  assert(xs.length > 0);
  return xs[(new RNG()).int32(xs.length)];
}

const range = (n: number): number[] =>
  Array(n)
    .fill(false)
    .map((_, i) => i);

const zip = <S, T>(xs: S[], ys: T[]): [S, T][] => {
  assert(xs.length === ys.length, () => `zip: ${debug(xs)}, ${debug(ys)}`);
  return xs.map((x, i): [S, T] => [x, ys[i]]);
};

export {Option, RNG, assert, clone, debug, flatten, nonnull, quote, sample, range, zip};
