# A grammar that uses Latin-to-Hindi transliteration to parse noun phrases.

@{% const include = require('../hindi/include'); %}

@enable_generation

@lexer {% include.lexer %}

# The main body of the grammar.

main -> _ noun_phrase _ {% (= $1) %}

noun_phrase -> %determiner:? _ adjective_phrase:? _ %noun {%
  (= {determiner: $0, modifiers: $2, noun: $4})
  (? $4 $0 $2)
%}

adjective_phrase -> adjective_phrase _ %adjective {% (= [...$0, $2]) %}
adjective_phrase -> %adjective {% (= [$0]) %}

_ -> (null | _ %_ | _ %token) {% (! -1) %}
