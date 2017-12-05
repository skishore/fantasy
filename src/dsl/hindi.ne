# A grammar that uses Latin-to-Hindi transliteration to parse noun phrases.

@{% const include = require('../hindi/include'); %}

@templated @lexer {% include.lexer %}

# The main body of the grammar.

main -> _ subject _ {% (= $1) %}

noun_phrase[X] -> %determiner:? _ adjective_phrase:? _ $X {%
  (= {determiner: $0, modifiers: $2, ...$4})
  (? $4 $0 $2)
%}
| %determiner:? _ %number _ adjective_phrase:? _ %noun {%
  (= {count: $2, determiner: $0, modifiers: $4, noun: $6})
  (? $2 $6 $0 $4)
%}

noun_direct ->
  %noun_direct_singular {% (= {count: 'singular', noun: $0}) %} |
  %noun_direct_plural {% (= {count: 'plural', noun: $0}) (! -0.1) %} |
  %noun_oblique_singular {% (= {count: 'singular', noun: $0}) (! -0.2) %} |
  %noun_oblique_plural {% (= {count: 'plural', noun: $0}) (! -0.3) %}

subject -> noun_phrase[noun_direct] {% (= $0) (? {case: 'direct'} $0) %}

adjective_phrase -> adjective_phrase _ %adjective {% (= [...$0, $2]) %}
adjective_phrase -> %adjective {% (= [$0]) %}

_ -> null | _ %_ | s %token s {% (! -10) %}
s -> null | s %_
