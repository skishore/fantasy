import {assert} from '../lib/base';
import {CompiledGrammar, CompiledRule, Compiler} from './compiler';
import {Grammar, Term} from './grammar';
import {Parser} from './parser';
import {Template} from '../lib/template';

// The output of the fantasy grammar is a list of ItemNode values.

type DirectiveNode =
  {type: 'score-gen', score: number} |
  {type: 'score-par', score: number} |
  {type: 'template', template: string};

type ExprNode =
  {type: 'binding', name: string} |
  {type: 'macro', args: ExprNode[], name: string} |
  {type: 'term', term: Term};

type ItemNode =
  {type: 'block', block: string} |
  {type: 'lexer', lexer: string} |
  {type: 'rule', rule: RuleNode};

type LhsNode =
  {type: 'macro', name: string, args: string[]} |
  {type: 'symbol', name: string, root: boolean};

type RhsNode = {type: Sign, terms: TermNode[], directives: DirectiveNode[]};

type RuleNode = {directives: DirectiveNode[], lhs: LhsNode, rhs: RhsNode[]};

type TermNode =
  {type: 'expr', expr: ExprNode, mark: '-' | '^' | '*', optional: boolean} |
  {type: 'punctuation', punctuation: string};

// This compiler converts those items into the CompiledGrammar output format,
// using an Environment to keep track of assigned symbols and bound variables.

type Both<T> = {gen: T, par: T};

interface Environment {
  bindings: {[name: string]: Term};
  exists: {[name: string]: boolean};
  macros: {[name: string]: {args: string[], rule: RuleNode}};
  result: Both<CompiledGrammar>;
}

interface Rule {base: Both<CompiledRule>, template?: string, type: Sign};

type Mark = '-' | '^' | '*';

type Sign = '<' | '=' | '>';

const [kRoot, kSpace] = ['$', '_'];

// The core compiler logic is a series of operations on the env state.

const add_block = (block: string, env: Environment): void => {
  Object.values(env.result).forEach((x) => x.blocks.push(block));
}

const add_directive = (directive: DirectiveNode, rule: Rule): void => {
  switch(directive.type) {
    case 'score-gen': rule.base.gen.score = directive.score; break;
    case 'score-par': rule.base.par.score = directive.score; break;
    case 'template': rule.template = directive.template; break;
  }
}

const add_lexer = (lexer: string, env: Environment): void => {
  Object.values(env.result).forEach((x) => x.lexer = lexer);
}

const add_macro = (rule: RuleNode, env: Environment): void => {
  if (rule.lhs.type !== 'macro') return;
  const name = rule.lhs.name;
  if (env.macros[name]) throw Error(`Duplicate macro: ${name}`);
  env.macros[name] = {args: rule.lhs.args, rule};
}

const add_rhs = (lhs: string, rhs: RhsNode, env: Environment): void => {
  const expressions: ExprNode[] = [];
  const punctuation: string[] = [''];

  // Collect interleaved expression and punctuation terms. There will always
  // be one more punctuation term than there is expression terms.
  for (const term of rhs.terms) {
    if (term.type === 'expr') {
      expressions.push(term.expr);
      punctuation.push('');
    } else {
      punctuation.push(`${punctuation.pop()}${term.punctuation}`);
    }
  }

  // TODO(skishore): Handle the '-' | '^' | '*' marks here.
  // TODO(skishore): Handle optional terms here.
  const rule: Rule = {base: gen(() => ({lhs, rhs: []})), type: rhs.type};
  rhs.directives.forEach((x) => add_directive(x, rule));
  const text = punctuation[0];
  if (text) rule.base.gen.rhs.push({text});
  const terms = expressions.map((x) => build_term(x, env));
  terms.forEach((x, i) => {
    const text = punctuation[i + 1] || ' ';
    rule.base.gen.rhs.push(x);
    rule.base.gen.rhs.push({text});
    rule.base.par.rhs.push(x);
    rule.base.par.rhs.push(kSpace);
  });
  if (!punctuation.pop()) rule.base.gen.rhs.pop();
  rule.base.par.rhs.pop();
  add_rule(rule, env);
}

const add_rule = (rule: Rule, env: Environment): void => {
  const template = `new Template(${JSON.stringify(rule.template)})`;
  if (rule.type !== '<') {
    const base = rule.template ? {transform: `${template}.split`} : {};
    env.result.gen.rules.push({...base, ...rule.base.gen});
  }
  if (rule.type !== '>') {
    const base = rule.template ? {transform: `${template}.merge`} : {};
    env.result.par.rules.push({...base, ...rule.base.par});
  }
}

const add_symbol = (rule: RuleNode, env: Environment): void => {
  if (rule.lhs.type !== 'symbol') return;
  const {name, root} = rule.lhs;
  if (root) {
    const gen = {lhs: kRoot, rhs: [name]}
    const par = {lhs: kRoot, rhs: [kSpace, name, kSpace]};
    const template = `{${JSON.stringify(name)}: $0}`;
    add_rule({base: {gen, par}, template, type: '='}, env);
  }
  const period: TermNode = {type: 'punctuation', punctuation: '.'};
  rule.rhs.forEach((x) => {
    const add_period = root && x.terms[x.terms.length - 1].type === 'expr';
    const directives = rule.directives.concat(x.directives);
    const terms = add_period ? x.terms.concat([period]) : x.terms;
    add_rhs(name, {...x, directives, terms}, env);
  });
}

const build_binding = (name: string, env: Environment): Term => {
  if (!env.bindings[name]) throw Error(`Unknown binding: @${name}`);
  return env.bindings[name];
}

const build_macro = (args: ExprNode[], name: string,
                     env: Environment): Term => {
  // Compute a symbol for the macro given these arguments.
  const macro = env.macros[name];
  if (!macro) throw new Error(`Unbound macro: ${name}`);
  const n = macro.args.length;
  if (args.length !== n) {
    throw new Error(`${name} got ${args.length} argments; expected: ${n}`);
  }
  const terms = args.map((x) => build_term(x, env));
  const symbol = `${name}[${terms.map(Grammar.print_term).join(', ')}]`;
  if (env.exists[symbol]) return symbol;

  // Add rules needed for this new macro instantiation.
  const bindings = Object.assign({}, env.bindings);
  const child = Object.assign({}, env, {bindings});
  terms.forEach((x, i) => child.bindings[macro.args[i]] = x);
  const lhs: LhsNode = {name: symbol, root: false, type: 'symbol'};
  add_symbol({...macro.rule, lhs}, child);
  env.exists[symbol] = true;
  return symbol;
}

const build_term = (expr: ExprNode, env: Environment): Term => {
  switch (expr.type) {
    case 'binding': return build_binding(expr.name, env);
    case 'macro': return build_macro(expr.args, expr.name, env);
    case 'term': return expr.term;
  }
}

const evaluate = (items: ItemNode[]): Both<CompiledGrammar> => {
  const result: Both<CompiledGrammar> =
      gen(() => ({blocks: [], rules: [], start: kRoot}));
  const env: Environment = {bindings: {}, exists: {}, macros: {}, result};

  // Add macro rules first so that regular rules can reference them.
  for (const item of items) {
    if (item.type === 'rule') add_macro(item.rule, env);
  }
  for (const item of items) {
    switch (item.type) {
      case 'block': add_block(item.block, env); break;
      case 'lexer': add_lexer(item.lexer, env); break;
      case 'rule': add_symbol(item.rule, env); break;
    }
  }

  // TODO(skishore): Check that the lexer is set and that it can generate
  // text for each `text` and `type` term that appears in any rule RHS.

  // Add default rules for dealing with whitespace and punctuation.
  result.par.rules.push({lhs: kSpace, rhs: []});
  result.par.rules.push({lhs: kSpace, rhs: [kSpace, {type: '_'}]});
  result.par.rules.push({lhs: kSpace, rhs: [kSpace, {type: 'w'}]});
  return result;
}

const gen = <T>(fn: () => T): Both<T> => ({gen: fn(), par: fn()});

const map = <T,U>(fn: (x: T) => U, xs: Both<T>): Both<U> => {
  return {gen: fn(xs.gen), par: fn(xs.par)};
}

// The public Fantasy interface - for now, a single pure function.

class Fantasy {
  static compile(input: string): Both<string> {
    const grammar = Grammar.from_file('../dsl/fantasy');
    const ast = Parser.parse(grammar, input).value!.some;
    return map(Compiler.generate, evaluate(ast));
  }
}

export {Fantasy};

// A quick test of the Fantasy interface on a real Hindi grammar.

declare const require: any;
const fs = require('fs');
const input = fs.readFileSync('src/dsl/hindi.gr');
console.log(Fantasy.compile(input).gen);
