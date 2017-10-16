# A grammar describing "templates", JSON-like expressions with variables.

@{% const lexer = require('../parsing/lexer'); %}

@lexer {% new lexer.MooLexer({
  boolean: {match: /(?:false|true)\b/, value: (x) => x === 'true'},
  float: {match: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)\b/, value: (x) => parseFloat(x, 10)},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  integer: {match: /-?(?:[0-9]|[1-9][0-9]+)\b/, value: (x) => parseInt(x, 10)},
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
}) %}

@{%

const create_list = (d) => d[0].concat(d[1].map((x) => x[3][0]));

const create_join = (d) => [].concat.apply([], d.map((x) => x instanceof Array ? x : [x]));

%}

commas[X] -> $X (_ "," _ $X):* {% create_list %}

# The body of our grammar.

main -> _ template _ {% (d) => d[1] %}
template -> (dict | join | list | primitive | variable) {% (d) => d[0][0] %}
dict -> "{" _ commas[item] _ "}" {% (d) => d[2] %}
      | "{" _ "}" {% () => [] %}
join -> "(" _ commas[dict_or_variable] _ ")" {% (d) => create_join(d[2]) %}
      | "(" _ commas[list_or_variable] _ ")" {% (d) => create_join(d[2]) %}
      | "(" _ ")" {% () => [] %}
list -> "[" _ commas[template] _ "]" {% (d) => d[2].map((x) => ['_', x]) %}
      | "[" _ "]" {% () => [] %}
variable -> "$" %integer {% (d) => ({index: d[1]}) %}

item -> %identifier _ ":" _ template {% (d) => [d[0], d[4]] %}
dict_or_variable -> (dict | variable) {% (d) => d[0][0] %}
list_or_variable -> (list | variable) {% (d) => d[0][0] %}

# Primitives and whitespace.

primitive -> (%boolean | number | %string) {% (d) => d[0][0] %}
number -> (%float | %integer) {% (d) => d[0][0] %}
_ -> %whitespace:? {% () => null %}
