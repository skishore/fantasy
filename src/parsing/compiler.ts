import {Grammar} from './grammar';
import {Parser} from './parser';

// The output of the bootstrapped grammar is a list of ItemNode values.

type AST = ItemNode[];

type ItemNode =
  {type: 'block', block: string} |
  {type: 'lexer', lexer: string} |
  {type: 'macro', name: string, rules: RuleNode[], args: string[]} |
  {type: 'rules', name: string, rules: RuleNode[]};

type RuleNode = {exprs: ExprNode[], transform?: string};

type ExprNode =
  {type: 'binding', name: string} |
  {type: 'macro', name: string, terms: Term[]} |
  {type: 'modifier', base: ExprNode, modifier: '?' | '*' | '+'} |
  {type: 'subexpression', rules: RuleNode[]} |
  {type: 'term', term: Term};

// This compiler converts those items into the CompiledGrammar output format,
// using an Environment to keep track of assigned symbols and bound variables.

interface CompiledGrammar {
  blocks: string[];
  lexer?: string;
  rules: CompiledRule[];
  start: string;
}

interface CompiledRule {
  lhs: string;
  rhs: Term[];
  transform?: string,
}

interface Environment {
  bindings: {[name: string]: Term};
  counts: {[name: string]: number};
  macros: {[name: string]: {args: string[], rules: RuleNode[]}};
  result: CompiledGrammar;
}

type Term = string | {text: string} | {type: string};

// The implementation of the compiler, a series of transformations.

const add_rules = (lhs: string, rule: RuleNode, env: Environment): void => {
  const rhs = rule.exprs.map((x) => build_term(lhs, x, env));
  env.result.rules.push({lhs, rhs, transform: rule.transform});
}

const add_symbol = (lhs: string, suffix: string, env: Environment): string => {
  const name = `${lhs}$${suffix}`;
  const count = env.counts[name] = (env.counts[name] || 0) + 1;
  return `${name}$${count}`;
}

const build_binding = (name: string, env: Environment): Term => {
  if (!env.bindings[name]) throw new Error(`Unbound varibale: $${name}`);
  return env.bindings[name];
}

const build_macro = (lhs: string, name: string, terms: Term[],
                     env: Environment): Term => {
  const symbol = add_symbol(lhs, 'macro', env);
  const macro = env.macros[name];
  if (!macro) throw new Error(`Unbound macro: ${name}`);
  const n = macro.args.length;
  if (terms.length !== n) {
    throw new Error(`${name} got ${terms.length} argments; expected: ${n}`);
  }
  const bindings = Object.assign({}, env.bindings);
  const child = Object.assign({}, env, {bindings});
  for (let i = 0; i < n; i++) {
    child.bindings[macro.args[i]] = terms[i];
  }
  macro.rules.forEach((x) => add_rules(symbol, x, child));
  return symbol;
}

const build_modifier = (lhs: string, modifier: '?' | '*' | '+',
                        expr: ExprNode, env: Environment): Term => {
  const rules: RuleNode[] = [];
  const symbol = add_symbol(lhs, 'modifier', env);
  const transform = '(d) => d[0].concat([d[1]])';
  if (modifier === '?') {
    rules.push({exprs: [], transform: '(d) => null'});
    rules.push({exprs: [expr], transform: '(d) => d[0]'});
  } else if (modifier === '*') {
    rules.push({exprs: []});
    rules.push({exprs: [{type: 'term', term: symbol}, expr], transform});
  } else if (modifier === '+') {
    rules.push({exprs: [expr]});
    rules.push({exprs: [{type: 'term', term: symbol}, expr], transform});
  }
  rules.forEach((x) => add_rules(symbol, x, env));
  return symbol;
}

const build_subexpression = (lhs: string, rules: RuleNode[],
                             env: Environment): Term => {
  const symbol = add_symbol(lhs, 'subexpression', env);
  rules.forEach((x) => add_rules(symbol, x, env));
  return symbol;
}

const build_term = (lhs: string, expr: ExprNode, env: Environment): Term => {
  switch (expr.type) {
    case 'binding': return build_binding(expr.name, env);
    case 'macro': return build_macro(lhs, expr.name, expr.terms, env);
    case 'modifier': return build_modifier(lhs, expr.modifier, expr.base, env);
    case 'subexpression': return build_subexpression(lhs, expr.rules, env);
    case 'term': return expr.term;
  }
}

const evaluate = (ast: AST): CompiledGrammar => {
  const result = {blocks: [], rules: [], start: ''};
  const env = {bindings: {}, counts: {}, macros: {}, result};
  ast.forEach((x) => evaluate_item(x, env));
  return validate(result);
}

const evaluate_item = (item: ItemNode, env: Environment): void => {
  switch (item.type) {
    case 'block': env.result.blocks.push(item.block); break;
    case 'lexer': env.result.lexer = item.lexer; break;
    case 'macro': env.macros[item.name] = item; break;
    case 'rules':
      if (!env.result.start) env.result.start = item.name;
      item.rules.forEach((x) => add_rules(item.name, x, env));
  }
}

const generate = (grammar: CompiledGrammar): string => {
  grammar = JSON.parse(JSON.stringify(grammar));
  if (!grammar.lexer) {
    grammar.blocks.unshift(`const lexer = require('../src/nearley/lexer');`);
    grammar.lexer = 'new lexer.CharacterLexer()';
  }
  return `
"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

${grammar.blocks.map((x) => x.trim()).join('\n\n')}

exports.grammar = {
  rules: [
    ${grammar.rules.map(generate_rule).join(',\n    ')},
  ],
  start: ${JSON.stringify(grammar.start)},
};

exports.lexer = ${grammar.lexer.trim()};
  `.trim() + '\n';
}

const generate_rule = (rule: CompiledRule): string => {
  const rhs = `[${rule.rhs.map(generate_term).join(', ')}]`;
  const transform = rule.transform ? `, transform: ${rule.transform}` : '';
  return `{lhs: ${JSON.stringify(rule.lhs)}, rhs: ${rhs}${transform}}`;
}

const generate_term = (term: Term): string => {
  if (typeof term === 'string') {
    return JSON.stringify(term);
  } else if ((<any>term).text) {
    return `{text: ${JSON.stringify((<any>term).text)}}`;
  } else if ((<any>term).type) {
    return `{type: ${JSON.stringify((<any>term).type)}}`;
  }
  throw Error(`Unexpected term: ${term}`);
}

const validate = (grammar: CompiledGrammar): CompiledGrammar => {
  if (!grammar.start) throw Error(`No grammar start term!`);
  const lhs = new Set<string>();
  const rhs = new Set<string>([grammar.start]);
  grammar.rules.forEach((x) => {
    lhs.add(x.lhs);
    x.rhs.forEach((y) => { if (typeof y === 'string') rhs.add(y); });
  });
  const dead_end = Array.from(rhs).filter((x) => !lhs.has(x)).sort();
  const unreachable = Array.from(lhs).filter((x) => !rhs.has(x)).sort();
  if (dead_end.length > 0) {
    throw Error(`Found dead-end symbols: ${dead_end.join(', ')}`);
  } else if (unreachable.length > 0) {
    throw Error(`Found unreachable symbols: ${unreachable.join(', ')}`);
  }
  return grammar;
}

// The public compiler interface - for now, a single pure function.

class Compiler {
  static compile(input: string): string {
    const grammar = Grammar.from_file('../dsl/bootstrapped');
    const ast = Parser.parse(grammar, input);
    return generate(evaluate(ast));
  }
}

export {Compiler};
