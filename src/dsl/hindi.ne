# A grammar that uses Latin-to-Hindi transliteration to parse noun phrases.

@{% const include = require('../hindi/include'); %}

@templated @lexer {% include.lexer %}

# The main body of the grammar.

main -> _ subject _ verb_phrase _ {% (= {subject: $1, predicate: $3}) %}

# Adjective-phrase modeling.

adjective_phrase -> maybe_adjective_phrase %adjective {% (= [...$0, $1]) %}
maybe_adjective_phrase -> adjective_phrase _ {% (= $0) %} | null

# Noun-phrase modeling.

noun_phrase[X] -> maybe_determiner maybe_adjective_phrase $X {%
  (= {determiner: $0, modifiers: $1, ...$2})
  (? $2 $0 $1)
%}
| maybe_determiner %number _ maybe_adjective_phrase %noun {%
  (= {count: $1, determiner: $0, modifiers: $3, noun: $4})
  (? $1 $4 $0 $3)
%}

maybe_determiner -> %determiner _ {% (= $0) %} | null

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
