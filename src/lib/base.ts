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

const clone = <T>(value: T): T =>
  value instanceof Object ? JSON.parse(JSON.stringify(value)) : value;

const debug = <T>(value: T): string =>
  util.inspect(value, {breakLength: Infinity, colors: true, depth: null});

const flatten = <T>(xss: T[][]): T[] => {
  const result: T[] = [];
  xss.forEach(xs => xs.forEach(x => result.push(x)));
  return result;
};

// tslint:disable-next-line:no-any
const nonnull = <T>(x: T | null): T => (assert(x !== null) as any) || x!;

const range = (n: number): number[] =>
  Array(n)
    .fill(false)
    .map((_, i) => i);

const sample = <T>(xs: T[]): T | null => {
  return xs.length === 0 ? null : xs[Math.floor(Math.random() * xs.length)];
};

const zip = <S, T>(xs: S[], ys: T[]): [S, T][] => {
  assert(xs.length === ys.length, () => `zip: ${debug(xs)}, ${debug(ys)}`);
  return xs.map((x, i): [S, T] => [x, ys[i]]);
};

export {Option, assert, clone, debug, flatten, nonnull, range, sample, zip};
