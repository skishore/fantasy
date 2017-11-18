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
%}

adjective_phrase -> adjective_phrase _ PT_adjective {% (= [...$0, $2]) %}
adjective_phrase -> PT_adjective {% (= [$0]) %}

_ -> (null | _ %whitespace | _ %_)

PT_adjective -> 'bare' {% (= 'large') %}
PT_adjective -> 'baree' {% (= 'large') %}
PT_adjective -> 'cote' {% (= 'small') %}
PT_adjective -> 'cotee' {% (= 'small') %}

PT_count -> 'ek' {% (= 1) %}
PT_count -> 'do' {% (= 2) %}
PT_count -> 'teen' {% (= 3) %}
PT_count -> 'caar' {% (= 4) %}

PT_determiner -> 'voh' {% (= 'that') %}
PT_determiner -> 'yeh' {% (= 'this') %}

PT_noun -> 'aadmee' {% (= 'man') %}
PT_noun -> 'aurat' {% (= 'woman') %}
PT_noun -> 'larka' {% (= 'boy') %}
PT_noun -> 'larki' {% (= 'girl') %}
