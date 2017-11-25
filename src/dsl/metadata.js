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

const list = (d) => [d[0]].concat(d[1].map((x) => x[1]));

exports.lexer = new lexer.MooLexer({
  close: ')',
  integer: {match: /-?(?:[0-9]|[1-9][0-9]+)\b/, value: (x) => parseInt(x, 10)},
  string: lexer.MooLexer.string,
  whitespace: /\s+/,
  _: /./,
});

exports.rules = [
  {lhs: "main$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "main$modifier$1$subexpression$1", rhs: ["_", "item"]},
  {lhs: "main$modifier$1", rhs: ["main$modifier$1", "main$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "main", rhs: ["item", "main$modifier$1"], transform: list},
  {lhs: "item", rhs: [{text: "("}, "_", {text: "?"}, "_", "checks", "_", {text: ")"}], transform: (d) => ({type: 'checks', checks: d[4]})},
  {lhs: "item", rhs: [{text: "("}, "_", {text: "!"}, "_", "scores", "_", {text: ")"}], transform: (d) => ({type: 'score', score: d[4]})},
  {lhs: "item", rhs: [{text: "("}, "_", {text: "="}, "_", "tokens", "_", {text: ")"}], transform: (d) => ({type: 'template', template: d[4]})},
  {lhs: "checks$modifier$1", rhs: [], transform: builtin_base_cases['?']},
  {lhs: "checks$modifier$1$subexpression$1", rhs: ["check", "_"]},
  {lhs: "checks$modifier$1", rhs: ["checks$modifier$1$subexpression$1"], transform: builtin_recursives['?']},
  {lhs: "checks$modifier$2", rhs: [], transform: builtin_base_cases['?']},
  {lhs: "checks$modifier$2", rhs: ["extra"], transform: builtin_recursives['?']},
  {lhs: "checks", rhs: ["checks$modifier$1", "checks$modifier$2"], transform: (d) => [d[0] ? d[0][0] : []].concat(d[1] || [])},
  {lhs: "extra$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "extra$modifier$1$subexpression$1", rhs: ["_", "parenthesized_check"]},
  {lhs: "extra$modifier$1", rhs: ["extra$modifier$1", "extra$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "extra", rhs: ["parenthesized_check", "extra$modifier$1"], transform: list},
  {lhs: "parenthesized_check", rhs: [{text: "("}, "_", "check", "_", {text: ")"}], transform: (d) => d[2]},
  {lhs: "check$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "check$modifier$1$subexpression$1", rhs: ["_", "element"]},
  {lhs: "check$modifier$1", rhs: ["check$modifier$1", "check$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "check", rhs: ["element", "check$modifier$1"], transform: list},
  {lhs: "element", rhs: [{text: "{"}, "_", "tokens", "_", {text: "}"}], transform: (d) => `{${d[2]}}`},
  {lhs: "element", rhs: [{text: "$"}, {type: "integer"}], transform: (d) => d[1]},
  {lhs: "scores$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "scores$modifier$1", rhs: ["scores$modifier$1", "score_suffix"], transform: builtin_recursives['*']},
  {lhs: "scores", rhs: ["score", "scores$modifier$1"], transform: (d) => [d[0]].concat(d[1])},
  {lhs: "score", rhs: [{type: "integer"}], transform: (d) => d[0]},
  {lhs: "score", rhs: [{type: "integer"}, "_", {text: "*"}, "_", {text: "$"}, {type: "integer"}], transform: (d) => ({i: d[5], score: d[0]})},
  {lhs: "score_suffix", rhs: ["_", {text: "+"}, "_", "score"], transform: (d) => d[3]},
  {lhs: "score_suffix", rhs: ["_", {text: "-"}, "_", "score"], transform: (d) => typeof d[3] === 'number' ? -d[3] : {i: d[3].i, score: -d[3].score}},
  {lhs: "tokens$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "tokens$modifier$1$subexpression$1", rhs: ["_", "token"]},
  {lhs: "tokens$modifier$1", rhs: ["tokens$modifier$1", "tokens$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "tokens", rhs: ["token", "tokens$modifier$1"], transform: (d) => `${d[0]}${d[1].map((x) => x.join('')).join('')}`},
  {lhs: "token", rhs: [{type: "string"}], transform: (d) => JSON.stringify(d[0])},
  {lhs: "token$subexpression$1", rhs: [{type: "integer"}]},
  {lhs: "token$subexpression$1", rhs: [{type: "_"}]},
  {lhs: "token", rhs: ["token$subexpression$1"], transform: (d) => `${d[0][0]}`},
  {lhs: "_$modifier$1", rhs: [], transform: builtin_base_cases['?']},
  {lhs: "_$modifier$1", rhs: [{type: "whitespace"}], transform: builtin_recursives['?']},
  {lhs: "_", rhs: ["_$modifier$1"], transform: (d) => d[0] || ''},
];

exports.start = "main";
