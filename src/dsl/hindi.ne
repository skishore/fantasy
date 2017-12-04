# A grammar that uses Latin-to-Hindi transliteration to parse noun phrases.

@{% const include = require('../hindi/include'); %}

@templated @lexer {% include.lexer %}

# The main body of the grammar.

main -> _ noun_phrase _ {% (= $1) (? {case: 'direct'} $1) %}

noun_phrase -> %determiner:? _ adjective_phrase:? _ %noun {%
  (= {determiner: $0, modifiers: $2, noun: $4})
  (? $4 $0 $2)
%}

adjective_phrase -> adjective_phrase _ %adjective {% (= [...$0, $2]) %}
adjective_phrase -> %adjective {% (= [$0]) %}

_ -> _ %token {% (! -1) %}
_ -> (null | _ %_)
