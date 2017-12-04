import {Compiler} from '../../src/parsing/compiler';
import {Corrector} from '../../src/parsing/corrector';
import {Derivation} from '../../src/parsing/derivation';
import {Grammar} from '../../src/parsing/grammar';
import {Parser} from '../../src/parsing/parser';
import {Test} from '../test';

const corrector: Test = {
  correction_works: () => {
    const data = `
      # Our corrector test uses a basic Hindi grammar with agreement for noun
      # phrase counts and genders. We will correct an input utterance with it.

      @{% const lexer = require('../parsing/lexer'); %}

      @templated @lexer {% new lexer.MooLexer({
        identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
        whitespace: {match: /\s+/, value: () => null},
        _: /./,
      }) %}

      # The main body of the grammar.

      main -> np {% (= $0) %}

      np -> PT_determiner:? _ PT_count:? _ ap _ PT_noun {%
        (= {count: $2, determiner: $0, modifiers: $4, noun: $6})
        (? $2 $6 $0 $4)
      %}

      ap -> ap _ PT_adjective {% (= [...$0, $2]) %}
      ap -> PT_adjective {% (= [$0]) %}

      _ -> (null | _ %whitespace | _ %_)

      PT_adjective -> 'bara' {% (= 'large') (? {count: 's', gender: 'm'}) %}
      PT_adjective -> 'bare' {% (= 'large') (? {count: 'p', gender: 'm'}) %}
      PT_adjective -> 'bari' {% (= 'large') (? {gender: 'f'}) %}

      PT_count -> 'ek' {% (= 1) (? {count: 's'}) %}
      PT_count -> 'do' {% (= 2) (? {count: 'p'}) %}

      PT_determiner -> 'voh' {% (= 'that') (? {count: 's'}) %}
      PT_determiner -> 'veh' {% (= 'that') (? {count: 'p'}) %}
      PT_determiner -> 'yeh' {% (= 'this') %}

      PT_noun -> 'aadmi' {% (= 'man') (? {count: 's', gender: 'm'}) %}
      PT_noun -> 'aadmiyo' {% (= 'man') (? {count: 'p', gender: 'm'}) %}
      PT_noun -> 'aurat' {% (= 'woman') (? {count: 's', gender: 'f'}) %}
      PT_noun -> 'aurte' {% (= 'woman') (? {count: 'p', gender: 'f'}) %}
    `;
    const grammar = Grammar.from_code(Compiler.compile(data));
    const input = 'do bara bari aadmi';
    const derivation = Parser.parse(grammar, input);
    const correction = Corrector.correct(derivation, grammar);
    Test.assert_eq(correction.output, 'do bare bare aadmiyo');
    Test.assert_eq(correction.issues.length, 3);
    Test.assert_eq(correction.issues[0].range, [3, 7]);
    Test.assert_eq(correction.issues[0].error, 'count should be p (was: s)');
    Test.assert_eq(correction.issues[1].range, [8, 12]);
    Test.assert_eq(correction.issues[1].error, 'gender should be m (was: f)');
    Test.assert_eq(correction.issues[2].range, [13, 18]);
    Test.assert_eq(correction.issues[2].error, 'count should be p (was: s)');
  },
};

export {corrector};
