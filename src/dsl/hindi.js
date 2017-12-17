"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const template = require('../lib/template');

const builtin_base_cases = {
  '?': new template.Template('[]', []),
  '*': new template.Template('[]', []),
  '+': new template.Template('[$0]', [false]),
};
const builtin_recursives = {
  '?': new template.Template('$0', [false]),
  '*': new template.Template('[...$0, $1]', [true, false]),
  '+': new template.Template('[...$0, $1]', [false, false]),
};

const include = require('../hindi/include');

exports.lexer = include.lexer;
exports.rules = [
  {lhs: "main$modifier$1", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "main$modifier$1$subexpression$1", rhs: [{type: "token"}, "s"]},
  {lhs: "main$modifier$1", rhs: ["main$modifier$1$subexpression$1"], transform: builtin_recursives["?"], score: 0},
  {lhs: "main$modifier$2", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "main$modifier$2$subexpression$1", rhs: ["s", {type: "token"}]},
  {lhs: "main$modifier$2", rhs: ["main$modifier$2$subexpression$1"], transform: builtin_recursives["?"], score: 0},
  {lhs: "main", rhs: ["main$modifier$1", "intent", "main$modifier$2"], transform: new template.Template("$1",[true,false,true])},
  {lhs: "intent", rhs: ["how_are_you"], transform: new template.Template("{how_are_you: true}",[false])},
  {lhs: "intent", rhs: ["i_am_good"], transform: new template.Template("{i_am_good: true}",[false])},
  {lhs: "intent", rhs: ["i_want"], transform: new template.Template("{i_want: $0}",[false])},
  {lhs: "intent", rhs: ["my_name_is"], transform: new template.Template("{my_name_is: $0}",[false])},
  {lhs: "intent", rhs: ["whats_your_name"], transform: new template.Template("{whats_your_name: true}",[false])},
  {lhs: "how_are_you", rhs: [{text: "aap"}, "_", {text: "kaise"}, "_", {text: "hai"}]},
  {lhs: "how_are_you", rhs: [{text: "kya"}, "_", {text: "haal"}, "_", {text: "hai"}]},
  {lhs: "i_am_good", rhs: [{text: "main"}, "_", "good", "_", {text: "hoon"}]},
  {lhs: "i_want", rhs: [{text: "main"}, "_", "object", "_", {text: "letha"}], transform: new template.Template("$2",[false,false,false,false,false]), syntaxes: [{"indices":[0,4],"tense":{}}, {"indices":[1],"tense":{}}, {"indices":[2],"tense":{}}, {"indices":[3],"tense":{}}]},
  {lhs: "my_name_is", rhs: [{text: "main"}, "name", {text: "hoon"}], transform: new template.Template("$1",[false,false,false])},
  {lhs: "my_name_is", rhs: [{text: "mera"}, "_", {text: "naam"}, "name", {text: "hai"}], transform: new template.Template("$3",[false,false,false,false,false]), syntaxes: [{"indices":[2,4,0],"tense":{}}, {"indices":[1],"tense":{}}, {"indices":[3],"tense":{}}]},
  {lhs: "whats_your_name", rhs: [{text: "aap"}, "_", {text: "kaun"}, "_", {text: "ho"}]},
  {lhs: "whats_your_name", rhs: [{text: "aapka"}, "_", {text: "naam"}, "_", {text: "kya"}, "_", {text: "hai"}], syntaxes: [{"indices":[2,0,4,6],"tense":{}}, {"indices":[1],"tense":{}}, {"indices":[3],"tense":{}}, {"indices":[5],"tense":{}}]},
  {lhs: "adjective_phrase", rhs: ["maybe_adjective_phrase", {type: "adjective"}], transform: new template.Template("[...$0, $1]",[false,false])},
  {lhs: "maybe_adjective_phrase", rhs: ["adjective_phrase", "_"], transform: new template.Template("$0",[false,false])},
  {lhs: "maybe_adjective_phrase", rhs: []},
  {lhs: "maybe_determiner", rhs: [{type: "determiner"}, "_"], transform: new template.Template("$0",[false,false])},
  {lhs: "maybe_determiner", rhs: [], transform: new template.Template("{}",[])},
  {lhs: "object$macro$1", rhs: ["maybe_determiner", {type: "number"}, "_", "maybe_adjective_phrase", {type: "noun"}], transform: new template.Template("{count: $1, determiner: $0, modifiers: $3, noun: $4}",[false,false,false,false,false]), syntaxes: [{"indices":[1,4,0,3],"tense":{}}, {"indices":[2],"tense":{}}]},
  {lhs: "object$macro$1", rhs: ["maybe_determiner", "maybe_adjective_phrase", {type: "noun_oblique_singular"}], transform: new template.Template("{count: \"singular\", determiner: $0, modifiers: $1, noun: $2}",[false,false,false]), syntaxes: [{"indices":[2,0,1],"tense":{}}]},
  {lhs: "object$macro$1", rhs: ["maybe_determiner", "maybe_adjective_phrase", {type: "noun_oblique_plural"}], transform: new template.Template("{count: \"plural\", determiner: $0, modifiers: $1, noun: $2}",[false,false,false]), syntaxes: [{"indices":[2,0,1],"tense":{}}], score: -0.1},
  {lhs: "object", rhs: ["object$macro$1"], transform: new template.Template("$0",[false]), syntaxes: [{"indices":[0],"tense":{"case":"oblique","person":"third"}}]},
  {lhs: "object", rhs: [{type: "pronoun"}], transform: new template.Template("{pronoun: $0}",[false])},
  {lhs: "good", rhs: [{text: "accha"}]},
  {lhs: "good", rhs: [{text: "theek"}]},
  {lhs: "name", rhs: ["s", {type: "token"}, "s"], transform: new template.Template("$1",[false,false,false])},
  {lhs: "_", rhs: [{type: "_"}]},
  {lhs: "_", rhs: ["_", {type: "_"}]},
  {lhs: "_", rhs: ["s", {type: "token"}, "s"], score: -10},
  {lhs: "s", rhs: [{type: "_"}]},
  {lhs: "s", rhs: ["s", {type: "_"}]},
];
exports.start = "main";
exports.templated = true;
