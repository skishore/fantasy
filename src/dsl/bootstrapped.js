"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const builtin_base_cases = {
  '?': (d) => null,
  '*': (d) => d,
  '+': (d) => d,
};
const builtin_recursives = {
  '?': (d) => d[0],
  '*': (d) => d[0].concat([d[1]]),
  '+': (d) => d[0].concat([d[1]]),
};

const lexer = require('../parsing/lexer');

exports.lexer = new lexer.MooLexer({
  block: {match: /{%[^]*?[%]}/, value: (x) => x.slice(2, -2).trim()},
  comment: {match: /#.*$/, value: (x) => null},
  keyword: {match: 'null', value: () => null},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
});

exports.rules = [
  {lhs: "main", rhs: ["_", "items", "_"], transform: (d) => d[1]},
  {lhs: "items$macro$1$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "items$macro$1$modifier$1$subexpression$1", rhs: ["_", "item"]},
  {lhs: "items$macro$1$modifier$1", rhs: ["items$macro$1$modifier$1", "items$macro$1$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "items$macro$1", rhs: ["item", "items$macro$1$modifier$1"], transform: (d) => [d[0]].concat(d[1].map((x) => x[1]))},
  {lhs: "items", rhs: ["items$macro$1"], transform: (d) => d[0]},
  {lhs: "item", rhs: [{text: "@"}, "_", {type: "block"}], transform: (d) => ({type: 'block', block: d[2]})},
  {lhs: "item", rhs: [{text: "@"}, {text: "lexer"}, "_", {type: "block"}], transform: (d) => ({type: 'lexer', lexer: d[3]})},
  {lhs: "item", rhs: ["word", {text: "["}, "words", {text: "]"}, "_", {text: "-"}, {text: ">"}, "_", "rules"], transform: (d) => ({type: 'macro', name: d[0], rules: d[8], args: d[2]})},
  {lhs: "item", rhs: ["word", "_", {text: "-"}, {text: ">"}, "_", "rules"], transform: (d) => ({type: 'rules', name: d[0], rules: d[5]})},
  {lhs: "item", rhs: [{text: "@"}, {text: "enable_generation"}], transform: (d) => ({type: 'setting', setting: 'generative'})},
  {lhs: "rules$macro$1$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "rules$macro$1$modifier$1$subexpression$1", rhs: ["_", {text: "|"}, "_", "rule"]},
  {lhs: "rules$macro$1$modifier$1", rhs: ["rules$macro$1$modifier$1", "rules$macro$1$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "rules$macro$1", rhs: ["rule", "rules$macro$1$modifier$1"], transform: (d) => [d[0]].concat(d[1].map((x) => x[3]))},
  {lhs: "rules", rhs: ["rules$macro$1"], transform: (d) => d[0]},
  {lhs: "rule", rhs: ["exprs"], transform: (d) => ({exprs: d[0]})},
  {lhs: "rule", rhs: ["exprs", "_", {type: "block"}], transform: (d) => ({exprs: d[0], metadata: d[2]})},
  {lhs: "exprs$macro$1$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "exprs$macro$1$modifier$1$subexpression$1", rhs: ["_", "expr"]},
  {lhs: "exprs$macro$1$modifier$1", rhs: ["exprs$macro$1$modifier$1", "exprs$macro$1$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "exprs$macro$1", rhs: ["expr", "exprs$macro$1$modifier$1"], transform: (d) => [d[0]].concat(d[1].map((x) => x[1]))},
  {lhs: "exprs", rhs: ["exprs$macro$1"], transform: (d) => d[0]},
  {lhs: "exprs", rhs: [{type: "keyword"}], transform: (d) => []},
  {lhs: "expr", rhs: [{text: "$"}, "word"], transform: (d) => ({type: 'binding', name: d[1]})},
  {lhs: "expr$macro$1$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "expr$macro$1$modifier$1$subexpression$1", rhs: ["_", {text: ","}, "_", "term"]},
  {lhs: "expr$macro$1$modifier$1", rhs: ["expr$macro$1$modifier$1", "expr$macro$1$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "expr$macro$1", rhs: ["term", "expr$macro$1$modifier$1"], transform: (d) => [d[0]].concat(d[1].map((x) => x[3]))},
  {lhs: "expr", rhs: ["word", {text: "["}, "expr$macro$1", {text: "]"}], transform: (d) => ({type: 'macro', name: d[0], terms: d[2]})},
  {lhs: "expr", rhs: ["expr", "_", {text: ":"}, "_", "modifier"], transform: (d) => ({type: 'modifier', base: d[0], modifier: d[4]})},
  {lhs: "expr", rhs: [{text: "("}, "_", "rules", "_", {text: ")"}], transform: (d) => ({type: 'subexpression', rules: d[2]})},
  {lhs: "expr", rhs: ["term"], transform: (d) => ({type: 'term', term: d[0]})},
  {lhs: "term", rhs: ["word"], transform: (d) => d[0]},
  {lhs: "term", rhs: [{type: "string"}], transform: (d) => ({text: d[0]})},
  {lhs: "term", rhs: [{text: "%"}, "word"], transform: (d) => ({type: d[1]})},
  {lhs: "modifier$subexpression$1", rhs: [{text: "?"}]},
  {lhs: "modifier$subexpression$1", rhs: [{text: "*"}]},
  {lhs: "modifier$subexpression$1", rhs: [{text: "+"}]},
  {lhs: "modifier", rhs: ["modifier$subexpression$1"], transform: (d) => d[0][0]},
  {lhs: "words$macro$1$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "words$macro$1$modifier$1$subexpression$1", rhs: ["_", {text: ","}, "_", "word"]},
  {lhs: "words$macro$1$modifier$1", rhs: ["words$macro$1$modifier$1", "words$macro$1$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "words$macro$1", rhs: ["word", "words$macro$1$modifier$1"], transform: (d) => [d[0]].concat(d[1].map((x) => x[3]))},
  {lhs: "words", rhs: ["words$macro$1"], transform: (d) => d[0]},
  {lhs: "word", rhs: [{type: "identifier"}], transform: (d) => d[0]},
  {lhs: "_$subexpression$1", rhs: []},
  {lhs: "_$subexpression$1", rhs: ["_", {type: "comment"}]},
  {lhs: "_$subexpression$1", rhs: ["_", {type: "whitespace"}]},
  {lhs: "_", rhs: ["_$subexpression$1"], transform: (d) => null},
];

exports.start = "main";
