# A grammar describing "templates", JSON-like expressions with variables.

@{% const lexer = require('../parsing/lexer'); %}

@lexer {% new lexer.MooLexer({
  boolean: {match: /(?:false|true)\b/, value: (x) => x === 'true'},
  float: lexer.MooLexer.float,
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  integer: lexer.MooLexer.integer,
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
}) %}

commas[X] -> $X (_ ',' _ $X):* {% (d) => [d[0]].concat(d[1].map((x) => x[3])) %}

# The body of our grammar.

main -> _ template _ {% (d) => d[1] %}

template -> (dict | list | primitive | variable) {% (d) => d[0][0] %}

dict -> '{' _ commas[dict_item] _ '}' {% (d) => d[2] %}
      | '{' _ '}' {% () => [] %}

dict_item -> key ':' _ template {% (d) => [d[0], d[3]] %}
           | '.' '.' '.' variable {% (d) => d[3] %}

list -> '[' _ commas[list_item] _ ']' {% (d) => d[2] %}
      | '[' _ ']' {% () => [] %}

list_item -> template {% (d) => ['_', d[0]] %}
           | '.' '.' '.' variable {% (d) => d[3] %}

variable -> '$' %integer {% (d) => ({index: d[1]}) %}

# Primitives and whitespace.

key -> (%identifier | %string) {% (d) => d[0][0] %}

number -> (%float | %integer) {% (d) => d[0][0] %}

primitive -> (%boolean | number | %string) {% (d) => d[0][0] %}

_ -> %whitespace:? {% () => null %}
