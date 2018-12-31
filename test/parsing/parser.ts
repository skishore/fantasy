import {range} from '../../src/lib/base';
import {Grammar, Lexer, Match, Term, Token} from '../../src/parsing/base';
import {Parser} from '../../src/parsing/parser';
import {Test} from '../test';

type Spec<T> = {lhs: string; rhs: string[]; fn: (xs: T[]) => T; score?: number};

const make_grammar = <T>(specs: Spec<T>[], value: T): Grammar<unknown, T> => {
  const lex = (input: string) =>
    Array.from(input).map(x => {
      const match: Match<T> = {score: 0, value};
      return {matches: {'%character': match, [x]: match}, text: x};
    });
  const lexer = {lex, unlex: () => []};
  const rules = specs.map(x => ({
    lhs: x.lhs,
    rhs: x.rhs.map(make_term),
    merge: {fn: x.fn, score: x.score || 0},
    split: {fn: () => [], score: 0},
  }));
  return {key: JSON.stringify, lexer, rules, start: '$Root'};
};

const make_term = (name: string): Term => {
  return {name, terminal: !name.startsWith('$')};
};

const parser: Test = {
  parsing_works: () => {
    const grammar = make_grammar(
      [
        {lhs: '$Root', rhs: ['$Add'], fn: x => x[0]},
        {lhs: '$Add', rhs: ['$Mul'], fn: x => x[0]},
        {lhs: '$Add', rhs: ['$Add', '+', '$Mul'], fn: x => x[0] + x[2]},
        {lhs: '$Add', rhs: ['$Add', '-', '$Mul'], fn: x => x[0] - x[2]},
        {lhs: '$Mul', rhs: ['$Num'], fn: x => x[0]},
        {lhs: '$Mul', rhs: ['$Mul', '*', '$Num'], fn: x => x[0] * x[2]},
        {lhs: '$Mul', rhs: ['$Mul', '/', '$Num'], fn: x => x[0] / x[2]},
        {lhs: '$Num', rhs: ['(', '$Add', ')'], fn: x => x[1]},
        ...range(10).map(i => ({lhs: '$Num', rhs: [`${i}`], fn: () => i})),
      ],
      0,
    );
    Test.assert_eq(Parser.parse(grammar, '(1+2)*3-4+5*6'), {some: 35});
    Test.assert_eq(Parser.parse(grammar, '1+2*(3-4)+5*6'), {some: 29});
    Test.assert_eq(Parser.parse(grammar, '1+2*3-4)+5*(6'), null);
  },
  scoring_works: () => {
    const fn = (xs: string[]) => xs.join('');
    const grammar = make_grammar(
      [
        {lhs: '$Root', rhs: ['$As'], fn},
        {lhs: '$Root', rhs: ['$Bs'], fn},
        {lhs: '$Root', rhs: ['$Neither'], fn: () => ''},
        {lhs: '$As', rhs: ['$As', '$A'], fn},
        {lhs: '$As', rhs: [], fn},
        {lhs: '$A', rhs: ['a'], fn: () => 'a', score: 1},
        {lhs: '$A', rhs: ['%character'], fn: x => '', score: -1},
        {lhs: '$Bs', rhs: ['$Bs', '$B'], fn},
        {lhs: '$Bs', rhs: [], fn},
        {lhs: '$B', rhs: ['b'], fn: () => 'b', score: 1},
        {lhs: '$B', rhs: ['%character'], fn: x => '', score: -1},
        {lhs: '$Neither', rhs: ['$Neither', '%character'], fn},
        {lhs: '$Neither', rhs: ['%character'], fn},
      ],
      '',
    );
    Test.assert_eq(Parser.parse(grammar, 'aaa'), {some: 'aaa'});
    Test.assert_eq(Parser.parse(grammar, 'aab'), {some: 'aa'});
    Test.assert_eq(Parser.parse(grammar, 'abb'), {some: 'bb'});
    Test.assert_eq(Parser.parse(grammar, 'bab'), {some: 'bb'});
    Test.assert_eq(Parser.parse(grammar, 'b?b'), {some: 'bb'});
    Test.assert_eq(Parser.parse(grammar, 'b??'), {some: ''});
  },
  skipping_works: () => {
    const grammar = make_grammar(
      [
        {lhs: '$Root', rhs: ['$Add', '$Whitespace'], fn: x => x[0]},
        {lhs: '$Add', rhs: ['$Add', '+', '$Num'], fn: x => x[0] + x[2]},
        {lhs: '$Add', rhs: ['$Num'], fn: x => x[0]},
        {lhs: '$Whitespace', rhs: ['$Whitespace', ' '], fn: x => 0},
        {lhs: '$Whitespace', rhs: [], fn: x => 0},
        ...range(10).map(i => ({lhs: '$Num', rhs: [`${i}`], fn: () => i})),
      ],
      0,
    );
    const skip = (window: number) => ({penalty: -1, window});
    Test.assert_eq(Parser.parse(grammar, '1+2+3  '), {some: 6});
    Test.assert_eq(Parser.parse(grammar, '1+2?+3 '), null);
    Test.assert_eq(Parser.parse(grammar, '1+2+3 ?'), null);
    Test.assert_eq(Parser.parse(grammar, '1+2?+3 ', skip(1)), {some: 6});
    Test.assert_eq(Parser.parse(grammar, '1+2+3 ?', skip(1)), {some: 6});
    Test.assert_eq(Parser.parse(grammar, '1+2??+3', skip(1)), null);
    Test.assert_eq(Parser.parse(grammar, '1+2??+3', skip(2)), {some: 6});
  },
};

export {parser};
