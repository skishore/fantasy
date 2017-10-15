"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const lexer = require('../target/nearley/lexer');

exports.grammar = {
  rules: [
    {lhs: "main", rhs: ["_", "items", "_"], transform: (d) => d[1]},
    {lhs: "items$macro$1$arg$1", rhs: ["item"]},
    {lhs: "items$macro$1$modifier$1", rhs: []},
    {lhs: "items$macro$1$modifier$1$subexpression$1", rhs: ["_", "items$macro$1$arg$1"]},
    {lhs: "items$macro$1$modifier$1", rhs: ["items$macro$1$modifier$1", "items$macro$1$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "items$macro$1", rhs: ["items$macro$1$arg$1", "items$macro$1$modifier$1"], transform: (d) => d[0].concat(d[1].map((x) => x[1][0]))},
    {lhs: "items", rhs: ["items$macro$1"], transform: (d) => d[0]},
    {lhs: "item", rhs: [{text: "@"}, "_", {type: "block"}], transform: (d) => ({type: 'block', block: d[2]})},
    {lhs: "item", rhs: [{text: "@"}, {text: "lexer"}, "_", {type: "block"}], transform: (d) => ({type: 'lexer', lexer: d[3]})},
    {lhs: "item", rhs: ["word", {text: "["}, "words", {text: "]"}, "_", {text: "-"}, {text: ">"}, "_", "rules"], transform: (d) => ({type: 'macro', name: d[0], rules: d[8], args: d[2]})},
    {lhs: "item", rhs: ["word", "_", {text: "-"}, {text: ">"}, "_", "rules"], transform: (d) => ({type: 'rules', name: d[0], rules: d[5]})},
    {lhs: "rules$macro$1$arg$1", rhs: ["rule"]},
    {lhs: "rules$macro$1$arg$2", rhs: [{text: "|"}]},
    {lhs: "rules$macro$1$modifier$1", rhs: []},
    {lhs: "rules$macro$1$modifier$1$subexpression$1", rhs: ["_", "rules$macro$1$arg$2", "_", "rules$macro$1$arg$1"]},
    {lhs: "rules$macro$1$modifier$1", rhs: ["rules$macro$1$modifier$1", "rules$macro$1$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "rules$macro$1", rhs: ["rules$macro$1$arg$1", "rules$macro$1$modifier$1"], transform: (d) => d[0].concat(d[1].map((x) => x[3][0]))},
    {lhs: "rules", rhs: ["rules$macro$1"], transform: (d) => d[0]},
    {lhs: "rule", rhs: ["terms"], transform: (d) => ({terms: d[0]})},
    {lhs: "rule", rhs: ["terms", "_", {type: "block"}], transform: (d) => ({terms: d[0], transform: d[2]})},
    {lhs: "terms$macro$1$arg$1", rhs: ["term"]},
    {lhs: "terms$macro$1$modifier$1", rhs: []},
    {lhs: "terms$macro$1$modifier$1$subexpression$1", rhs: ["_", "terms$macro$1$arg$1"]},
    {lhs: "terms$macro$1$modifier$1", rhs: ["terms$macro$1$modifier$1", "terms$macro$1$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "terms$macro$1", rhs: ["terms$macro$1$arg$1", "terms$macro$1$modifier$1"], transform: (d) => d[0].concat(d[1].map((x) => x[1][0]))},
    {lhs: "terms", rhs: ["terms$macro$1"], transform: (d) => d[0]},
    {lhs: "terms", rhs: [{type: "keyword"}], transform: (d) => []},
    {lhs: "term", rhs: [{text: "$"}, "word"], transform: (d) => ({type: 'binding', name: d[1]})},
    {lhs: "term", rhs: ["word", {text: "["}, "args", {text: "]"}], transform: (d) => ({type: 'macro', name: d[0], args: d[2]})},
    {lhs: "term", rhs: ["term", "_", {text: ":"}, "_", "modifier"], transform: (d) => ({type: 'modifier', base: d[0], modifier: d[4]})},
    {lhs: "term", rhs: [{text: "("}, "_", "rules", "_", {text: ")"}], transform: (d) => ({type: 'subexpression', rules: d[2]})},
    {lhs: "term", rhs: ["word"], transform: (d) => ({type: 'symbol', symbol: d[0]})},
    {lhs: "term", rhs: [{type: "string"}], transform: (d) => ({type: 'token_text', token_text: d[0]})},
    {lhs: "term", rhs: [{text: "%"}, "word"], transform: (d) => ({type: 'token_type', token_type: d[1]})},
    {lhs: "args$macro$1$arg$1", rhs: ["rule"]},
    {lhs: "args$macro$1$arg$2", rhs: [{text: ","}]},
    {lhs: "args$macro$1$modifier$1", rhs: []},
    {lhs: "args$macro$1$modifier$1$subexpression$1", rhs: ["_", "args$macro$1$arg$2", "_", "args$macro$1$arg$1"]},
    {lhs: "args$macro$1$modifier$1", rhs: ["args$macro$1$modifier$1", "args$macro$1$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "args$macro$1", rhs: ["args$macro$1$arg$1", "args$macro$1$modifier$1"], transform: (d) => d[0].concat(d[1].map((x) => x[3][0]))},
    {lhs: "args", rhs: ["args$macro$1"], transform: (d) => d[0]},
    {lhs: "modifier$subexpression$1", rhs: [{text: "?"}]},
    {lhs: "modifier$subexpression$1", rhs: [{text: "*"}]},
    {lhs: "modifier$subexpression$1", rhs: [{text: "+"}]},
    {lhs: "modifier", rhs: ["modifier$subexpression$1"], transform: (d) => d[0][0]},
    {lhs: "words$macro$1$arg$1", rhs: ["word"]},
    {lhs: "words$macro$1$arg$2", rhs: [{text: ","}]},
    {lhs: "words$macro$1$modifier$1", rhs: []},
    {lhs: "words$macro$1$modifier$1$subexpression$1", rhs: ["_", "words$macro$1$arg$2", "_", "words$macro$1$arg$1"]},
    {lhs: "words$macro$1$modifier$1", rhs: ["words$macro$1$modifier$1", "words$macro$1$modifier$1$subexpression$1"], transform: (d) => d[0].concat([d[1]])},
    {lhs: "words$macro$1", rhs: ["words$macro$1$arg$1", "words$macro$1$modifier$1"], transform: (d) => d[0].concat(d[1].map((x) => x[3][0]))},
    {lhs: "words", rhs: ["words$macro$1"], transform: (d) => d[0]},
    {lhs: "word", rhs: [{type: "identifier"}], transform: (d) => d[0]},
    {lhs: "_$subexpression$1", rhs: []},
    {lhs: "_$subexpression$1", rhs: ["_", {type: "comment"}]},
    {lhs: "_$subexpression$1", rhs: ["_", {type: "whitespace"}]},
    {lhs: "_", rhs: ["_$subexpression$1"], transform: (d) => null},
  ],
  start: "main",
};

exports.lexer = new lexer.MooLexer({
  block: {match: /{%[^]*?[%]}/, value: (x) => x.slice(2, -2).trim()},
  comment: {match: /#.*$/, value: (x) => null},
  keyword: {match: 'null', value: () => null},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
});
