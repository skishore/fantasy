# A grammar that uses Latin-to-Hindi transliteration to parse noun phrases.

@{% const include = require('../hindi/include'); %}

@templated @lexer {% include.lexer %}

# The main body of the grammar, a list of supported intents.

main -> (%token s):? intent (s %token):? {% (= $1) %}

intent -> how_are_you {% (= {how_are_you: true}) %}
        | i_am_good {% (= {i_am_good: true}) %}
        | i_want {% (= {i_want: $0}) %}
        | my_name_is {% (= {my_name_is: $0}) %}
        | whats_your_name {% (= {whats_your_name: true}) %}

# Implementations of each of the supported intents.

how_are_you -> 'aap' _ 'kaise' _ 'hai'
             | 'kya' _ 'haal' _ 'hai'

i_am_good -> 'main' _ good _ 'hoon'

i_want -> 'main' _ object _ 'letha' {% (= $2) (? $0 $4) %}

my_name_is -> 'main' name 'hoon' {% (= $1) %}
            | 'mera' _ 'naam' name 'hai' {% (= $3) (? $2 $4 $0) %}

whats_your_name -> 'aap' _ 'kaun' _ 'ho'
                 | 'aapka' _ 'naam' _ 'kya' _ 'hai' {% (? $2 $0 $4 $6) %}

# General adjective- and noun-phrase modeling.

adjective_phrase -> maybe_adjective_phrase %adjective {% (= [...$0, $1]) %}

maybe_adjective_phrase -> adjective_phrase _ {% (= $0) %} | null

maybe_determiner -> %determiner _ {% (= $0) %} | null {% (= {}) %}

noun_phrase[X, Y] -> maybe_determiner %number _ maybe_adjective_phrase %noun {%
  (= {count: $1, determiner: $0, modifiers: $3, noun: $4})
  (? $1 $4 $0 $3)
%}
| maybe_determiner maybe_adjective_phrase $X {%
  (= {count: 'singular', determiner: $0, modifiers: $1, noun: $2})
  (? $2 $0 $1)
%}
| maybe_determiner maybe_adjective_phrase $Y {%
  (= {count: 'plural', determiner: $0, modifiers: $1, noun: $2})
  (? $2 $0 $1) (! -0.1)
%}

object -> noun_phrase[%noun_oblique_singular, %noun_oblique_plural] {%
  (= $0) (? {case: 'oblique', person: 'third'} $0)
%}
| %pronoun {% (= {pronoun: $0}) %}

# Simple auxiliary helpers.

good -> 'accha' | 'theek'

name -> s %token s {% (= $1) %}

_ -> %_ | _ %_ | s %token s {% (! -10) %}
s -> %_ | s %_
