import {Transliterator} from '../src/hindi/transliterator';
import {assert, nonnull, range, RNG} from '../src/lib/base';
import {Grammar, Match, Term} from '../src/parsing/base';
import {Corrector} from '../src/parsing/corrector';
import {Fantasy} from '../src/parsing/fantasy';
import {Generator} from '../src/parsing/generator';
import {Parser} from '../src/parsing//parser';
import {Lambda} from '../src/template/lambda';
import {Value} from '../src/template/value';
import {arithmetic} from './parsing/generator';

/* tslint:disable-next-line:no-any */
declare const process: any;
/* tslint:disable-next-line:no-any */
declare const require: any;
const fs = require('fs');
const input = fs.readFileSync('src/hindi/hindi.gr', 'utf8');
const grammar = Fantasy.parse(Lambda, input);

const base = Math.pow(10, 6);
const elapsed_time = (start: number, n: number): string => {
  const duration = (base / n * (Date.now() - start)).toLocaleString();
  const prefix = range(11 - duration.length).map(() => ' ').join('');
  return `${prefix}${duration} ns/iter`;
}

/* tslint:disable:no-console */
const bench = (n: number) => {
  console.log(`Running benchmarks with ${n} iterations...\n`);
  {
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      Lambda.template('Test(abc & def.ghi, jkl | (mno & pqr))');
    }
    console.log(`    Template DSL: ${elapsed_time(time, n)}`);
  }
  {
    const template = Lambda.template('Test(abc & def.ghi, jkl | (mno & pqr))');
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      nonnull(template.merge([]));
    }
    console.log(`    Lambda merge: ${elapsed_time(time, n)}`);
  }
  {
    const lambda = Lambda.parse('foo & bar & baz');
    const template = Lambda.template('$0 & $1');
    if (template.split(lambda).length !== 8) throw Error();
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      template.split(lambda);
    }
    console.log(`  Lambda split 1: ${elapsed_time(time, n)}`);
  }
  {
    const lambda = Lambda.parse('a & b & c.d');
    const template = Lambda.template('$0 & $1 & c.$2');
    if (template.split(lambda).length !== 12) throw Error();
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      template.split(lambda);
    }
    console.log(`  Lambda split 2: ${elapsed_time(time, n)}`);
  }
  {
    const template = Value.template(
      '{num: 17, str: "is", bool: false, list: [3, 5, 7]}');
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      nonnull(template.merge([]));
    }
    console.log(`      Json merge: ${elapsed_time(time, n)}`);
  }
  {
    const lambda = Value.parse('{x: 3, y: 5, z: 7}');
    const template = Value.template('{x: $0, y: $1, z: $2}');
    if (template.split(lambda).length !== 1) throw Error();
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      template.split(lambda);
    }
    console.log(`JsonDict split 1: ${elapsed_time(time, n)}`);
  }
  {
    const lambda = Value.parse('{x: 3, y: 5, z: 7}');
    const template = Value.template('{x: $0, y: $1, ...$2}');
    if (template.split(lambda).length !== 4) throw Error();
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      template.split(lambda);
    }
    console.log(`JsonDict split 2: ${elapsed_time(time, n)}`);
  }
  {
    const lambda = Value.parse('[3, 4, 5]');
    const template = Value.template('[$0, ...$1]');
    if (template.split(lambda).length !== 2) throw Error();
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      template.split(lambda);
    }
    console.log(`JsonList split 1: ${elapsed_time(time, n)}`);
  }
  {
    const lambda = Value.parse('[3, 4, 5]');
    const template = Value.template('[$0, ...$1, ...$2]');
    if (template.split(lambda).length !== 7) throw Error();
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      template.split(lambda);
    }
    console.log(`JsonList split 2: ${elapsed_time(time, n)}`);
  }
  {
    const time = Date.now();
    const T = new Transliterator('cAhIe cAhe cAhI cAh Cah cAhA'.split(' '));
    for (let i = 0; i < n; i++) {
      if (T.transliterate('chahie').length !== 6) throw new Error();
    }
    console.log(` Transliteration: ${elapsed_time(time, n)}`);
  }
  {
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
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      assert(nonnull(Parser.parse(grammar, '(1+2)*3-4+5*6')).some === 35);
    }
    console.log(`   Basic parsing: ${elapsed_time(time, n)}`);
  }
  {
    const grammar = arithmetic();
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      const rng = new RNG();
      Generator.generate(grammar, rng, 2);
    }
    console.log(`Basic generation: ${elapsed_time(time, n)}`);
  }
  {
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      nonnull(Parser.parse(grammar, 'meri bacche ko pani chahie'));
    }
    console.log(`      NL parsing: ${elapsed_time(time, n)}`);
  }
  {
    const lambda = Lambda.parse('Tell(owner.I & type.child, want.type.water)');
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      const rng = new RNG();
      nonnull(Generator.generate(grammar, rng, {some: lambda}));
    }
    console.log(`   NL generation: ${elapsed_time(time, n)}`);
  }
  {
    const base = Parser.parse(grammar, 'do accha acche larki ko pani chahie');
    const tree = nonnull(base).some;
    const time = Date.now();
    for (let i = 0; i < n; i++) {
      const rng = new RNG();
      nonnull(Corrector.correct(grammar, rng, tree));
    }
    console.log(`   NL correction: ${elapsed_time(time, n)}`);
  }
}

bench(parseInt(process.argv[2] || 1000, 10));
