import {nonnull} from './base';

type Output<T> =
  | {stop: Stop; i: number; success: true; result: T}
  | {stop: Stop; i: number; success: false};

type Parser<T> = (input: string, index: number) => Output<T>;

type Stop = {expected: string[]; i: number};

// Parsing primitives, for matching by regex or by string.

const swap_quotes = (x: string): string =>
  x.replace(/[\'\"]/g, y => (y === '"' ? "'" : '"'));

const fail = <T>(stop: Stop): Output<T> => ({stop, i: stop.i, success: false});

const succeed = <T>(i: number, result: T, stop?: Stop): Output<T> => ({
  stop: stop || {expected: [], i},
  i,
  success: true,
  result,
});

const regexp = (re: RegExp): Parser<string> => {
  const expected = [`${re}`];
  const flags = expected[0].slice(expected[0].lastIndexOf('/') + 1);
  const anchored = new RegExp(`^(?:${re.source})`, flags);
  return (input, i) => {
    const m = anchored.exec(input.slice(i));
    return m ? succeed(i + m[0].length, m[0]) : fail({expected, i});
  };
};

const string = (st: string): Parser<string> => {
  const expected = [swap_quotes(JSON.stringify(st))];
  return (input, i) => {
    const m = input.slice(i, i + st.length) === st;
    return m ? succeed(i + st.length, st) : fail({expected, i});
  };
};

// NOTE: We do this update destructively for a 10-20% performance win.
const update = (source: Stop, target: Stop | null): Stop => {
  if (!target || source.i > target.i) {
    const expected = source.expected.length > 0 ? source.expected.slice() : [];
    return {expected, i: source.i};
  }
  if (source.i < target.i) return target;
  source.expected.forEach(x => target.expected.push(x));
  return target;
};

// Parser combinators, for combining primitives.

// prettier-ignore
type AllParser = <T extends Parser<unknown>[]>(...parsers: T) =>
  Parser<{[K in keyof T]: T[K] extends Parser<infer U> ? U : never}>;

const all = <T>(...parsers: Parser<T>[]): Parser<T[]> => (x, i) => {
  let stop = null;
  const result = [];
  for (const parser of parsers) {
    const output = parser(x, i);
    stop = update(output.stop, stop);
    if (!output.success) return fail(stop);
    result.push(output.result);
    i = output.i;
  }
  return succeed(i, result, nonnull(stop));
};

const any = <T>(...parsers: Parser<T>[]): Parser<T> => (x, i) => {
  let stop = null;
  const start = i;
  for (const parser of parsers) {
    const output = parser(x, start);
    stop = update(output.stop, stop);
    if (output.success) return succeed(output.i, output.result, stop);
  }
  return fail(nonnull(stop));
};

const map = <S, T>(parser: Parser<S>, fn: (s: S) => T): Parser<T> => (x, i) => {
  const output = parser(x, i);
  if (!output.success) return output;
  return succeed(output.i, fn(output.result), output.stop);
};

const repeat = <T>(parser: Parser<T>, min = 0): Parser<T[]> => (x, i) => {
  const result = [];
  while (true) {
    const output = parser(x, i);
    if (!output.success) {
      if (result.length < min) return output;
      return succeed(i, result, output.stop);
    }
    result.push(output.result);
    i = output.i;
  }
};

const sep = <S, T>(term: Parser<S>, sep: Parser<T>, min = 0): Parser<S[]> => {
  const base = two(term, repeat(two(sep, term), Math.max(min - 1, 0)));
  const list = map(base, x => [x[0]].concat(x[1].map(y => y[1])));
  return min > 0 ? list : any(list, (x, i) => succeed(i, []));
};

// Error handling utilities.

const error = (input: string, index: number, expected: string[]): Error => {
  index = Math.max(Math.min(index, input.length), 0);
  const start = input.lastIndexOf('\n', index - 1) + 1;
  const maybe_end = input.indexOf('\n', start);
  const end = maybe_end < 0 ? input.length : maybe_end;
  const line = input.slice(0, index).split('\n').length;
  const column = index - start + 1;
  const highlight = input.substring(start, end);
  const terms = Array.from(new Set(expected)).sort();
  const error = `
At line ${line}, column ${column}: Expected: ${terms.join(' | ')}

  ${highlight}
  ${Array(column).join(' ')}^
  `.trim();
  return Error(error);
};

const two = (all as Function) as AllParser;

// Our public API. We create a Node class for ease of auto-completion.

// prettier-ignore
type AllNode = <T extends Node<unknown>[]>(...parsers: T) =>
  Node<{[K in keyof T]: T[K] extends Node<infer U> ? U : never}>;

const Base = {
  all: <T>(...parsers: Node<T>[]) => new Node(all(...parsers.map(x => x._))),
  any: <T>(...parsers: Node<T>[]) => new Node(any(...parsers.map(x => x._))),
  base: <T>(fn: Parser<T>) => new Node(fn),
  fail: (expected: string[]) => new Node((x, i) => fail({expected, i})),
  lazy: <T>(fn: () => Node<T>) => new Node((x, i) => fn()._(x, i)),
  regexp: (re: RegExp) => new Node(regexp(re)),
  string: (st: string) => new Node(string(st)),
  succeed: <T>(result: T) => new Node((x, i) => succeed(i, result)),
};

class Node<T> {
  constructor(public _: Parser<T>) {}
  and<U>(next: Node<U>) {
    return new Node(two(this._, next._));
  }
  map<U>(fn: (t: T) => U) {
    return new Node(map(this._, fn));
  }
  or(alternate: Node<T>) {
    return new Node(any(this._, alternate._));
  }
  parse(input: string): T {
    const output = this._(input, 0);
    if (output.success && output.i === input.length) return output.result;
    const {expected, i} = output.stop;
    const eof = output.success && output.i === i ? ['end of input'] : [];
    throw error(input, i, expected.concat(eof));
  }
  repeat<U>(min = 0, separator?: Node<U>) {
    if (separator) return new Node(sep(this._, separator._, min));
    return new Node(repeat(this._, min));
  }
  skip<U>(next: Node<U>) {
    return new Node(map(two(this._, next._), x => x[0]));
  }
  then<U>(next: Node<U>) {
    return new Node(map(two(this._, next._), x => x[1]));
  }
}

const Parser = {...Base, all: (Base.all as Function) as AllNode};

export {Node, Output, Parser};
