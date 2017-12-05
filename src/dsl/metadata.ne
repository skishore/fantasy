# A grammar describing "metadata", data associated with rules in a generative
# grammar that is used for scoring, semantics, and error correction.

@{% const lexer = require('../parsing/lexer'); %}

@lexer {% new lexer.MooLexer({
  close: ')',
  float: lexer.MooLexer.float,
  integer: lexer.MooLexer.integer,
  string: lexer.MooLexer.string,
  whitespace: /\s+/,
  _: /./,
}) %}

@{% const list = (d) => [d[0]].concat(d[1].map((x) => x[1])); %}

# The body of our grammar.

main -> item (_ item):* {% list %}

item -> "(" _ "!" _ scores _ ")" {% (d) => ({type: 'score', score: d[4]}) %}
      | "(" _ "?" _ syntax _ ")" {% (d) => ({type: 'syntax', syntaxes: d[4]}) %}
      | "(" _ "=" _ tokens _ ")" {% (d) => ({type: 'template', template: d[4]}) %}

syntax -> (check _):? extra:? {% (d) => [d[0] ? d[0][0] : []].concat(d[1] || []) %}

extra -> parenthesized_check (_ parenthesized_check):* {% list %}

parenthesized_check -> '(' _ check _ ')' {% (d) => d[2] %}

check -> element (_ element):* {% list %}

element -> '{' _ tokens _ '}' {% (d) => `{${d[2]}}` %}
         | '$' %integer {% (d) => d[1] %}

number -> (%float | %integer) {% (d) => d[0][0] %}

scores -> score score_suffix:* {% (d) => [d[0]].concat(d[1]) %}

score -> number {% (d) => d[0] %}
       | number _ "*" _ "$" %integer {% (d) => ({i: d[5], score: d[0]}) %}

score_suffix -> _ "+" _ score {% (d) => d[3] %}
              | _ "-" _ score {% (d) => typeof d[3] === 'number' ? -d[3] : {i: d[3].i, score: -d[3].score} %}

tokens -> token (_ token):* {% (d) => `${d[0]}${d[1].map((x) => x.join('')).join('')}` %}

token -> %string {% (d) => JSON.stringify(d[0]) %}
       | (%float | %integer | %_) {% (d) => `${d[0][0]}` %}

_ -> %whitespace:? {% (d) => d[0] || '' %}
