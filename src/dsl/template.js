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
  boolean: {match: /(?:false|true)\b/, value: (x) => x === 'true'},
  float: {match: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)\b/, value: (x) => parseFloat(x, 10)},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  integer: {match: /-?(?:[0-9]|[1-9][0-9]+)\b/, value: (x) => parseInt(x, 10)},
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
});
exports.rules = [
  {lhs: "main", rhs: ["_", "template", "_"], transform: (d) => d[1]},
  {lhs: "template$subexpression$1", rhs: ["dict"]},
  {lhs: "template$subexpression$1", rhs: ["list"]},
  {lhs: "template$subexpression$1", rhs: ["primitive"]},
  {lhs: "template$subexpression$1", rhs: ["variable"]},
  {lhs: "template", rhs: ["template$subexpression$1"], transform: (d) => d[0][0]},
  {lhs: "dict$macro$1$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "dict$macro$1$modifier$1$subexpression$1", rhs: ["_", {text: ","}, "_", "dict_item"]},
  {lhs: "dict$macro$1$modifier$1", rhs: ["dict$macro$1$modifier$1", "dict$macro$1$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "dict$macro$1", rhs: ["dict_item", "dict$macro$1$modifier$1"], transform: (d) => [d[0]].concat(d[1].map((x) => x[3]))},
  {lhs: "dict", rhs: [{text: "{"}, "_", "dict$macro$1", "_", {text: "}"}], transform: (d) => d[2]},
  {lhs: "dict", rhs: [{text: "{"}, "_", {text: "}"}], transform: () => []},
  {lhs: "dict_item", rhs: [{type: "identifier"}, {text: ":"}, "_", "template"], transform: (d) => [d[0], d[3]]},
  {lhs: "dict_item", rhs: [{text: "."}, {text: "."}, {text: "."}, "variable"], transform: (d) => d[3]},
  {lhs: "list$macro$1$modifier$1", rhs: [], transform: builtin_base_cases['*']},
  {lhs: "list$macro$1$modifier$1$subexpression$1", rhs: ["_", {text: ","}, "_", "list_item"]},
  {lhs: "list$macro$1$modifier$1", rhs: ["list$macro$1$modifier$1", "list$macro$1$modifier$1$subexpression$1"], transform: builtin_recursives['*']},
  {lhs: "list$macro$1", rhs: ["list_item", "list$macro$1$modifier$1"], transform: (d) => [d[0]].concat(d[1].map((x) => x[3]))},
  {lhs: "list", rhs: [{text: "["}, "_", "list$macro$1", "_", {text: "]"}], transform: (d) => d[2]},
  {lhs: "list", rhs: [{text: "["}, "_", {text: "]"}], transform: () => []},
  {lhs: "list_item", rhs: ["template"], transform: (d) => ['_', d[0]]},
  {lhs: "list_item", rhs: [{text: "."}, {text: "."}, {text: "."}, "variable"], transform: (d) => d[3]},
  {lhs: "variable", rhs: [{text: "$"}, {type: "integer"}], transform: (d) => ({index: d[1]})},
  {lhs: "primitive$subexpression$1", rhs: [{type: "boolean"}]},
  {lhs: "primitive$subexpression$1", rhs: ["number"]},
  {lhs: "primitive$subexpression$1", rhs: [{type: "string"}]},
  {lhs: "primitive", rhs: ["primitive$subexpression$1"], transform: (d) => d[0][0]},
  {lhs: "number$subexpression$1", rhs: [{type: "float"}]},
  {lhs: "number$subexpression$1", rhs: [{type: "integer"}]},
  {lhs: "number", rhs: ["number$subexpression$1"], transform: (d) => d[0][0]},
  {lhs: "_$modifier$1", rhs: [], transform: builtin_base_cases['?']},
  {lhs: "_$modifier$1", rhs: [{type: "whitespace"}], transform: builtin_recursives['?']},
  {lhs: "_", rhs: ["_$modifier$1"], transform: () => null},
];
exports.start = "main";
exports.templated = false;
