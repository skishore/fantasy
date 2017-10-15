declare const require: any;
const util = require('util');

type Option<T> = {some: T} | null;

const assert = (condition: boolean, message?: () => string) => {
  if (!condition) throw Error(message ? message() : undefined);
}

const clone = <T>(value: T): T =>
    value instanceof Object ? JSON.parse(JSON.stringify(value)) : value;

const debug = (value: any): string =>
    util.inspect(value, {breakLength: Infinity, colors: true, depth: null});

export {Option, assert, clone, debug};
