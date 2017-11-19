import {Compiler} from '../../src/parsing/compiler';
import {Derivation} from '../../src/parsing/derivation';
import {Generator} from '../../src/parsing/generator';
import {Grammar} from '../../src/parsing/grammar';
import {Parser} from '../../src/parsing/parser';
import {Test} from '../test';

const texts = (derivation: Derivation | null): string[] | null =>
    derivation ? Derivation.texts(derivation) : null;

const generator: Test = {
  generative_grammar_works: () => {
    const input = `
      # Our generator test is a simple grammar for parsing Hindi noun phrases.

      @{% const lexer = require('../parsing/lexer'); %}

      @enable_generation

      @lexer {% new lexer.MooLexer({
        identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
        whitespace: {match: /\s+/, value: () => null},
        _: /./,
      }) %}

      # The main body of the grammar.

      main -> PT_count:? _ adjectives:? _ PT_noun {%
        (= {count: $0, modifiers: $2, noun: $4})
      %}

      adjectives -> adjectives _ PT_adjective {% (= [...$0, $2]) %}
      adjectives -> PT_adjective {% (= [$0]) %}

      _ -> (null | _ %whitespace | _ %_)

      PT_adjective -> 'bare' {% (= 'large') %}
      PT_adjective -> 'chote' {% (= 'small') %}

      PT_count -> 'ek' {% (= 1) %}
      PT_count -> 'do' {% (= 2) %}

      PT_noun -> 'aadmi' {% (= 'man') %}
      PT_noun -> 'aurat' {% (= 'woman') %}
    `;
    const grammar = Grammar.from_code(Compiler.compile(input));
    const generate = (x: any) => texts(Generator.generate(grammar, x));
    Test.assert_eq(generate({noun: 'man'}), ['aadmi']);
    Test.assert_eq(generate({count: 2, noun: 'man'}), ['do', 'aadmi']);
    Test.assert_eq(generate({count: 3, noun: 'man'}), null);
    Test.assert_eq(generate({modifiers: ['large', 'small'], noun: 'woman'}),
                   ['bare', 'chote', 'aurat']);
  },
  random_generation_works: () => {
    const input = `
      # Our randomness test parses some simple S-expressions.

      @{% const lexer = require('../parsing/lexer'); %}

      @enable_generation

      @lexer {% new lexer.CharacterLexer() %}

      # The main body of the grammar.

      main -> '(' ' ':? parts ' ':? ')' {% (= $2) %}
      main -> part {% (= $0) %}

      parts -> parts ' ' main {% (= [...$0, $2]) %}
      parts -> main {% (= [$0]) %}

      part -> 'a' {% (= 'a') %}
      part -> 'b' {% (= 'b') %}
    `;
    const grammar = Grammar.from_code(Compiler.compile(input));
    const generate = (x: any) => texts(Generator.generate(grammar, x));
    const maybe = generate(['a', ['a', 'b']]);
    if (!maybe) throw Error(`Unable to generate S-expression!`);
    const result = maybe.join('');
    const xs = ['(a (a b))', '( a ( a b))', '(a (a b ) )', '( a ( a b ) )'];
    Test.assert_eq(xs.some((x) => x === result), true);
  },
};

export {generator};
