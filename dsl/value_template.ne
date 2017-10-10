# A lexer and a macro used to create comma-separated lists of terms.

@lexer lexer

@{%

const moo = require('../src/nearley/moo');

const swap_quotes = (x) => x.replace(/[\'\"]/g, (y) => y === '"' ? "'" : '"');

const lexer = moo.compile({
  boolean: {match: /(?:false|true)\b/, value: (x) => x === 'true'},
  float: {match: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)\b/, value: (x) => parseFloat(x, 10)},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  integer: {match: /-?(?:[0-9]|[1-9][0-9]+)\b/, value: (x) => parseInt(x, 10)},
  string: [
    {match: /"[^"]*"/, value: (x) => JSON.parse(x)},
    {match: /'[^']*'/, value: (x) => JSON.parse(swap_quotes(x))},
  ],
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
});

const create_list = (d) => d[0].concat(d[1].map((x) => x[3][0]));

const create_join = (d) =>
    [].concat.apply([], d.map((x) => x instanceof Array ? x : [x]))

%}

commas[X] -> $X (_ "," _ $X):+ {% create_list %}
           | $X {% (d) => d[0] %}

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
variable -> "$" %integer {% (d) => ({index: d[1].value}) %}

item -> %identifier _ ":" _ template {% (d) => [d[0].value, d[4]] %}
dict_or_variable -> (dict | variable) {% (d) => d[0][0] %}
list_or_variable -> (list | variable) {% (d) => d[0][0] %}

# Primitives and whitespace.

primitive -> (%boolean | number | %string) {% (d) => d[0][0].value %}
number -> (%float | %integer) {% (d) => d[0][0] %}
_ -> %whitespace:? {% () => null %}
