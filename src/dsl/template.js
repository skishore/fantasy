"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const lexer = require('../../target/parsing/lexer.js');

const create_list = (d) => d[0].concat(d[1].map((x) => x[3][0]));

const create_join = (d) => [].concat.apply([], d.map((x) => x instanceof Array ? x : [x]));

exports.grammar = {
  rules: [
    {lhs: "main", rhs: ["_", "template", "_"], transform: (d) => d[1]},
    {lhs: "template$subexpression$1", rhs: ["dict"]},
    {lhs: "template$subexpression$1", rhs: ["join"]},
    {lhs: "template$subexpression$1", rhs: ["list"]},
    {lhs: "template$subexpression$1", rhs: ["primitive"]},
    {lhs: "template$subexpression$1", rhs: ["variable"]},
    {lhs: "template", rhs: ["template$subexpression$1"], transform: (d) => d[0][0]},
    {lhs: "dict$macro$1$arg$1", rhs: ["item"]},
    {lhs: "dict$macro$1$modifier$1", rhs: []},
    {lhs: "dict$macro$1$modifier$1$subexpression$1", rhs: ["_", {text: ","}, "_", "dict$macro$1$arg$1"]},
    {lhs: "dict$macro$1$modifier$1", rhs: ["dict$macro$1$modifier$1", "dict$macro$1$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "dict$macro$1", rhs: ["dict$macro$1$arg$1", "dict$macro$1$modifier$1"], transform: create_list},
    {lhs: "dict", rhs: [{text: "{"}, "_", "dict$macro$1", "_", {text: "}"}], transform: (d) => d[2]},
    {lhs: "dict", rhs: [{text: "{"}, "_", {text: "}"}], transform: () => []},
    {lhs: "join$macro$1$arg$1", rhs: ["dict_or_variable"]},
    {lhs: "join$macro$1$modifier$1", rhs: []},
    {lhs: "join$macro$1$modifier$1$subexpression$1", rhs: ["_", {text: ","}, "_", "join$macro$1$arg$1"]},
    {lhs: "join$macro$1$modifier$1", rhs: ["join$macro$1$modifier$1", "join$macro$1$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "join$macro$1", rhs: ["join$macro$1$arg$1", "join$macro$1$modifier$1"], transform: create_list},
    {lhs: "join", rhs: [{text: "("}, "_", "join$macro$1", "_", {text: ")"}], transform: (d) => create_join(d[2])},
    {lhs: "join$macro$2$arg$1", rhs: ["list_or_variable"]},
    {lhs: "join$macro$2$modifier$1", rhs: []},
    {lhs: "join$macro$2$modifier$1$subexpression$1", rhs: ["_", {text: ","}, "_", "join$macro$2$arg$1"]},
    {lhs: "join$macro$2$modifier$1", rhs: ["join$macro$2$modifier$1", "join$macro$2$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "join$macro$2", rhs: ["join$macro$2$arg$1", "join$macro$2$modifier$1"], transform: create_list},
    {lhs: "join", rhs: [{text: "("}, "_", "join$macro$2", "_", {text: ")"}], transform: (d) => create_join(d[2])},
    {lhs: "join", rhs: [{text: "("}, "_", {text: ")"}], transform: () => []},
    {lhs: "list$macro$1$arg$1", rhs: ["template"]},
    {lhs: "list$macro$1$modifier$1", rhs: []},
    {lhs: "list$macro$1$modifier$1$subexpression$1", rhs: ["_", {text: ","}, "_", "list$macro$1$arg$1"]},
    {lhs: "list$macro$1$modifier$1", rhs: ["list$macro$1$modifier$1", "list$macro$1$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "list$macro$1", rhs: ["list$macro$1$arg$1", "list$macro$1$modifier$1"], transform: create_list},
    {lhs: "list", rhs: [{text: "["}, "_", "list$macro$1", "_", {text: "]"}], transform: (d) => d[2].map((x) => ['_', x])},
    {lhs: "list", rhs: [{text: "["}, "_", {text: "]"}], transform: () => []},
    {lhs: "variable", rhs: [{text: "$"}, {type: "integer"}], transform: (d) => ({index: d[1]})},
    {lhs: "item", rhs: [{type: "identifier"}, "_", {text: ":"}, "_", "template"], transform: (d) => [d[0], d[4]]},
    {lhs: "dict_or_variable$subexpression$1", rhs: ["dict"]},
    {lhs: "dict_or_variable$subexpression$1", rhs: ["variable"]},
    {lhs: "dict_or_variable", rhs: ["dict_or_variable$subexpression$1"], transform: (d) => d[0][0]},
    {lhs: "list_or_variable$subexpression$1", rhs: ["list"]},
    {lhs: "list_or_variable$subexpression$1", rhs: ["variable"]},
    {lhs: "list_or_variable", rhs: ["list_or_variable$subexpression$1"], transform: (d) => d[0][0]},
    {lhs: "primitive$subexpression$1", rhs: [{type: "boolean"}]},
    {lhs: "primitive$subexpression$1", rhs: ["number"]},
    {lhs: "primitive$subexpression$1", rhs: [{type: "string"}]},
    {lhs: "primitive", rhs: ["primitive$subexpression$1"], transform: (d) => d[0][0]},
    {lhs: "number$subexpression$1", rhs: [{type: "float"}]},
    {lhs: "number$subexpression$1", rhs: [{type: "integer"}]},
    {lhs: "number", rhs: ["number$subexpression$1"], transform: (d) => d[0][0]},
    {lhs: "_$modifier$1", rhs: [], transform: (d) => null},
    {lhs: "_$modifier$1", rhs: [{type: "whitespace"}], transform: (d) => d[0]},
    {lhs: "_", rhs: ["_$modifier$1"], transform: () => null},
  ],
  start: "main",
};

exports.lexer = new lexer.MooLexer({
  boolean: {match: /(?:false|true)\b/, value: (x) => x === 'true'},
  float: {match: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)\b/, value: (x) => parseFloat(x, 10)},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  integer: {match: /-?(?:[0-9]|[1-9][0-9]+)\b/, value: (x) => parseInt(x, 10)},
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
});
