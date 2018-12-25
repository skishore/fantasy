import {RNG, nonnull, range} from '../../src/lib/base';
import {Grammar, Lexer, Match, Term, Token} from '../../src/parsing/base';
import {Generator} from '../../src/parsing/generator';
import {Test} from '../test';

// Basic helpers for constructing a generative grammar.

type Spec<S> = {
  lhs: string;
  rhs: string[];
  fn: (x: S) => S[][];
  score?: number;
};

const make_grammar = <S>(specs: Spec<S>[], value: S): Grammar<S, string> => {
  const lex = (input: string) =>
    Array.from(input).map(x => {
      const m: Match<string> = {score: 0, value: x};
      return {text: x, text_matches: {[x]: m}, type_matches: {character: m}};
    });
  const unlex = (term: Term, v: S) => {
    const match = v === value && term.type === 'text';
    return match ? [{score: 0, value: term.value}] : [];
  };
  const rules = specs.map(x => ({
    lhs: x.lhs,
    rhs: x.rhs.map(make_term),
    merge: {fn: (xs: string[]) => xs.join(''), score: 0},
    split: {fn: x.fn, score: x.score || 0},
  }));
  return {key: JSON.stringify, lexer: {lex, unlex}, rules, start: '$Root'};
};

const make_term = (term: string): Term => {
  if (term.startsWith('$')) return {type: 'name', value: term};
  if (term.startsWith('%')) return {type: 'type', value: term.substring(1)};
  return {type: 'text', value: term};
};

// Our inverted arithmetic helpers. Each one shows how to construct a given
// number as a node of a tree - either as an operation node, or a number leaf.

const op = (fn: (x: number, y: number) => number) => (target: number) =>
  range(100)
    .map(x => [x % 10, 0, Math.floor(x / 10)])
    .filter(x => fn(x[0], x[2]) === target);

const num = (x: number) => (target: number) => (x === target ? [[0]] : []);

const arithmetic = (deepness?: number): Grammar<number, string> => {
  const score = -(deepness || 0);
  return make_grammar(
    [
      {lhs: '$Root', rhs: ['$Add'], fn: x => [[x]]},
      {lhs: '$Add', rhs: ['$Mul'], fn: x => [[x]], score},
      {lhs: '$Add', rhs: ['$Add', '+', '$Mul'], fn: op((x, y) => x + y)},
      {lhs: '$Add', rhs: ['$Add', '-', '$Mul'], fn: op((x, y) => x - y)},
      {lhs: '$Mul', rhs: ['$Num'], fn: x => [[x]], score},
      {lhs: '$Mul', rhs: ['$Mul', '*', '$Num'], fn: op((x, y) => x * y)},
      {lhs: '$Mul', rhs: ['$Mul', '/', '$Num'], fn: op((x, y) => x / y)},
      {lhs: '$Num', rhs: ['(', '$Add', ')'], fn: x => [[0, x, 0]]},
      ...range(10).map(i => ({lhs: '$Num', rhs: [`${i}`], fn: num(i)})),
    ],
    0,
  );
};

const generator: Test = {
  generation_works: () => {
    const grammar = arithmetic();
    const [seed, target] = [173, 2];
    const tests = [
      {op: '+', expected: '6-5+5/5+8*0'},
      {op: '-', expected: '9-7'},
      {op: '*', expected: '1*(8-6)*1'},
      {op: '/', expected: '1*(8-6)/1'},
    ];
    for (const {op, expected} of tests) {
      const rng = new RNG(seed);
      const rules = grammar.rules.filter(x => x.rhs.some(y => y.value === op));
      const maybe = Generator.generate_from_rules(grammar, rng, rules, target);
      Test.assert_eq(nonnull(maybe).some, expected);
    }
  },
  generation_uses_scores: () => {
    const [seed, target] = [17, 2];
    const tests = [
      {deepness: 3, expected: '9-8+6/6'},
      {deepness: -3, expected: '2'},
    ];
    for (const {deepness, expected} of tests) {
      const rng = new RNG(seed);
      const grammar = arithmetic(deepness);
      const maybe = Generator.generate(grammar, rng, target);
      Test.assert_eq(nonnull(maybe).some, expected);
    }
  },
};

export {generator};
