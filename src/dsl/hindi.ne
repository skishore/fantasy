# Simple test of Hindi noun phrases.

@{% const lexer = require('../parsing/lexer'); %}

@enable_generation

@lexer {% new lexer.MooLexer({
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
}) %}

# The main body of the grammar.

main -> noun_phrase {% (= $0) %}

noun_phrase -> PT_determiner:? _ PT_count:? _ adjective_phrase _ PT_noun {%
  (= {count: $2, determiner: $0, modifiers: $4, noun: $6})
  (? $2 $6 $0 $4)
%}

adjective_phrase -> adjective_phrase _ PT_adjective {% (= [...$0, $2]) %}
adjective_phrase -> PT_adjective {% (= [$0]) %}

_ -> (null | _ %whitespace | _ %_)

PT_adjective -> 'bara' {% (= 'large') (? {count: 'singular', gender: 'male'}) %}
PT_adjective -> 'bare' {% (= 'large') (? {count: 'plural', gender: 'male'}) %}
PT_adjective -> 'bari' {% (= 'large') (? {gender: 'female'}) %}

PT_count -> 'ek' {% (= 1) (? {count: 'singular'}) %}
PT_count -> 'do' {% (= 2) (? {count: 'plural'}) %}

PT_determiner -> 'voh' {% (= 'that') (? {count: 'singular'}) %}
PT_determiner -> 'veh' {% (= 'that') (? {count: 'plural'}) %}
PT_determiner -> 'yeh' {% (= 'this') %}

PT_noun -> 'aadmi' {% (= 'man') (? {count: 'singular', gender: 'male'}) %}
PT_noun -> 'aadmiyo' {% (= 'man') (? {count: 'plural', gender: 'male'}) %}
PT_noun -> 'aurat' {% (= 'woman') (? {count: 'singular', gender: 'female'}) %}
PT_noun -> 'aurte' {% (= 'woman') (? {count: 'plural', gender: 'female'}) %}
