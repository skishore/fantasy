import {Compiler} from '../../src/parsing/compiler';
import {Derivation} from '../../src/parsing/derivation';
import {Grammar} from '../../src/parsing/grammar';
import {Parser} from '../../src/parsing/parser';
import {Test} from '../test';

const parser: Test = {
  grammar_scoring_works: () => {
    const data = `
      # Our scoring test is a simple ambiguous grammar: a's must be included
      # in the parse, b's may be included, and c's are never included. We run
      # this grammar with scoring to verify that the scores change whether or
      # not the b's end up in the output.

      @{% const lexer = require('../parsing/lexer'); %}

      @templated @lexer {% new lexer.CharacterLexer() %}

      # The main body of the grammar.

      main -> main char _ {% (= [...$0, $1]) %}
      main -> _ {% (= []) %}

      char -> 'a' {% (= $0) %}
      char -> 'b' {% (= $0) %}

      _ -> (_ 'b' | _ 'c') {% (! -1) %}
      _ -> null
    `;
    const grammar = Grammar.from_code(Compiler.compile(data));
    const parse = (x: string) => Parser.parse(grammar, x);
    Test.assert_eq(parse('aabbcc').value, {some: ['a', 'a', 'b', 'b']});
    Test.assert_eq(parse('abcabc').value, {some: ['a', 'b', 'a', 'b']});
    grammar.rules.forEach((x) => x.score = -x.score);
    Test.assert_eq(parse('aabbcc').value, {some: ['a', 'a']});
    Test.assert_eq(parse('abcabc').value, {some: ['a', 'a']});
  },
};

export {parser};
