import {nonnull, range} from '../../src/lib/base';
import {Grammar, Lexer, Match, Term, Token} from '../../src/parsing/base';
import {Generator} from '../../src/parsing/generator';
import {Test} from '../test';

// Basic helpers for constructing a generative grammar.

type Spec<S> = {
  lhs: string;
  rhs: string[];
  fn: (x: S) => S[][];
};

const make_grammar = <S>(specs: Spec<S>[], value: S): Grammar<S, string> => {
  const lex = (input: string) =>
    Array.from(input).map(x => {
      const m: Match<string> = {score: 0, value: x};
      return {text: x, text_matches: {[x]: m}, type_matches: {character: m}};
    });
  const unlex = (term: Term, v: S) => {
    const match = v === value && term.type === 'text';
    return match ? {score: 0, value: term.value} : null;
  };
  const rules = specs.map(x => ({
    lhs: x.lhs,
    rhs: x.rhs.map(make_term),
    merge: {fn: (xs: string[]) => xs.join(''), score: 0},
    split: {fn: x.fn, score: 0},
  }));
  return {lexer: {lex, unlex}, rules, start: '$Root'};
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

const generator: Test = {
  generation_works: () => {
    const grammar = make_grammar(
      [
        {lhs: '$Root', rhs: ['$Add'], fn: x => [[x]]},
        {lhs: '$Add', rhs: ['$Mul'], fn: x => [[x]]},
        {lhs: '$Add', rhs: ['$Add', '+', '$Mul'], fn: op((x, y) => x + y)},
        {lhs: '$Add', rhs: ['$Add', '-', '$Mul'], fn: op((x, y) => x - y)},
        {lhs: '$Mul', rhs: ['$Num'], fn: x => [[x]]},
        {lhs: '$Mul', rhs: ['$Mul', '*', '$Num'], fn: op((x, y) => x * y)},
        {lhs: '$Mul', rhs: ['$Mul', '/', '$Num'], fn: op((x, y) => x / y)},
        {lhs: '$Num', rhs: ['(', '$Add', ')'], fn: x => [[0, x, 0]]},
        ...range(10).map(i => ({lhs: '$Num', rhs: [`${i}`], fn: num(i)})),
      ],
      0,
    );
    const target = 2;
    for (const op of '+-*/') {
      const rules = grammar.rules.filter(x => x.rhs.some(y => y.value === op));
      const maybe = Generator.generate_from_rules(grammar, rules, target);
      const sample = nonnull(maybe).some;
      Test.assert_eq(sample.includes(op), true);
      // TODO(skishore): Check the text instead once generator takes a seed.
      // tslint:disable-next-line:no-eval
      Test.assert_eq(eval(sample), target);
    }
  },
};

export {generator};
