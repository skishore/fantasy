import {range} from '../../src/lib/base';
import {Grammar, Lexer, Match, Term, Token} from '../../src/parsing/base';
import {Parser} from '../../src/parsing/parser';
import {Test} from '../test';

type Spec<T> = {lhs: string; rhs: string[]; fn: (xs: T[]) => T; score?: number};

const make_grammar = <T>(specs: Spec<T>[], value: T): Grammar<unknown, T> => {
  const lex = (input: string) =>
    Array.from(input).map(x => {
      const m: Match<T> = {score: 0, value};
      return {text: x, text_matches: {[x]: m}, type_matches: {character: m}};
    });
  const lexer = {lex, unlex: () => null};
  const rules = specs.map(x => ({
    lhs: x.lhs,
    rhs: x.rhs.map(make_term),
    merge: {fn: x.fn, score: x.score || 0},
    split: {fn: () => [], score: 0},
  }));
  return {key: JSON.stringify, lexer, rules, start: '$Root'};
};

const make_term = (term: string): Term => {
  if (term.startsWith('$')) return {type: 'name', value: term};
  if (term.startsWith('%')) return {type: 'type', value: term.substring(1)};
  return {type: 'text', value: term};
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
};

export {parser};
