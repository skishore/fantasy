@builtin "number.ne"
@builtin "string.ne"

# A macro used to create comma-separated lists of terms.

@{%

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
variable -> "$" int {% (d) => ({index: d[1]}) %}

item -> identifier _ ":" _ template {% (d) => [d[0], d[4]] %}
dict_or_variable -> (dict | variable) {% (d) => d[0][0] %}
list_or_variable -> (list | variable) {% (d) => d[0][0] %}

# Primitives and whitespace.

identifier -> [a-zA-Z0-9_$]:+ {% (d) => d[0].join('') %}
primitive -> (boolean | decimal | string) {% (d) => d[0][0] %}
boolean -> "false" {% () => false %} | "true" {% () => true %}
string -> (dqstring | sqstring) {% (d) => d[0][0] %}
_ -> [\s]:* {% () => null %}
