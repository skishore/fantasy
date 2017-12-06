# A grammar that uses Latin-to-Hindi transliteration to parse noun phrases.

@{% const include = require('../hindi/include'); %}

@templated @lexer {% include.lexer %}

# The main body of the grammar.

main -> _ subject _ verb_phrase _ {% (= {subject: $1, predicate: $3}) %}

# Adjective-phrase modeling.

adjective_phrase -> adjective_phrase _ %adjective {% (= [...$0, $2]) %}
adjective_phrase -> %adjective {% (= [$0]) %}

# Noun-phrase modeling.

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

noun_oblique ->
  %noun_oblique_singular {% (= {count: 'singular', noun: $0}) %} |
  %noun_oblique_plural {% (= {count: 'plural', noun: $0}) (! -0.1) %} |
  %noun_direct_singular {% (= {count: 'singular', noun: $0}) (! -0.2) %} |
  %noun_direct_plural {% (= {count: 'plural', noun: $0}) (! -0.3) %}

object -> noun_phrase[noun_oblique] {% (= $0) (? {case: 'oblique', person: 'third'} $0) %}
        | %pronoun {% (= {pronoun: $0}) %}

subject -> noun_phrase[noun_direct] {% (= $0) (? {case: 'direct', person: 'third'} $0) %}
         | %pronoun {% (= {pronoun: $0}) %}

# Verb-phrase modeling.

verb_phrase -> object _ %copula {% (= {verb: 'be', object: $0}) (? $2) %}
             | adjective_phrase _ %copula {% (= {verb: 'be', object: $0}) %}

_ -> null | _ %_ | s %token s {% (! -10) %}
s -> null | s %_
