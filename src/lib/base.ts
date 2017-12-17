declare const require: any;
const util = require('util');

type Option<T> = Some<T> | null;

interface Some<T> {some: T}

const assert = (condition: boolean, message?: () => string) => {
  if (!condition) throw Error(message ? message() : undefined);
}

const clone = <T>(value: T): T =>
    value instanceof Object ? JSON.parse(JSON.stringify(value)) : value;

const debug = (value: any): string =>
    util.inspect(value, {breakLength: Infinity, colors: true, depth: null});

const flatten = <T>(xss: T[][]): T[] => {
  const result: T[] = [];
  xss.forEach((xs) => xs.forEach((x) => result.push(x)));
  return result;
}

const sample = <T>(xs: T[]): T | null => {
  return xs.length === 0 ? null : xs[Math.floor(Math.random() * xs.length)];
}

export {Option, assert, clone, debug, flatten, sample};
