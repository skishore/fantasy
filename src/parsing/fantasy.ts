import {assert} from '../lib/base';
import {Lexer, Token, swap_quotes} from '../lib/lexer';
import {Grammar, Rule, Syntax, Term} from './grammar';
import {Template} from '../lib/template';

// Types used during grammar parsing.

type Both<T> = {gen: T, par: T};

type Mini = Partial<Rule> & Pick<Rule, 'lhs' | 'rhs' | 'transform'>;

type Slot = {index: number, optional: boolean};

interface Env {
  bindings: {[name: string]: Term};
  exists: {[name: string]: {root: boolean, rules: RuleNode[]}};
  macros: {[name: string]: {args: string[], rules: RuleNode[]}};
  result: Both<Grammar>;
}

interface One {
  lhs: string,
  rhs: Term[],
  score?: number,
  slots: Slot[],
}

interface Two {
  ones: Both<One>,
  sign: Sign,
  syntaxes?: Syntax[],
  template?: Template,
}

type ExprNode =
  {type: 'binding', name: string, token: Token} |
  {type: 'macro', args: ExprNode[], name: string, token: Token} |
  {type: 'term', term: Term, token: Token};

type RuleNode = {
  score_gen: number,
  score_par: number,
  sign: Sign,
  template?: Template,
  terms: TermNode[],
};

type TermNode =
  {type: 'expr', expr: ExprNode, mark: Mark, optional: boolean} |
  {type: 'punctuation', punctuation: string};

type Kind = 'gen' | 'par';

type Mark = '-' | '^' | '*';

type Sign = '<' | '=' | '>';

const [kRoot, kSpace] = ['$', '_'];

// Simple logic operations on tokens. Note that the usage of these operations
// means that the Fantasy language has significant whitespace.

const adjacent = (token: Token): boolean =>
    token.offset > 0 && token.input[token.offset - 1].trim().length > 0;

const initial = (token: Token): boolean =>
    token.offset === 0 || token.input[token.offset - 1] === '\n';

const chr = (xs: string, x: string): boolean =>
    xs.includes(x) && x.length === 1;

const gen = <T>(fn: () => T): Both<T> => ({gen: fn(), par: fn()});

const map = <T,U>(xs: Both<T>, fn: (x: T) => U): Both<U> =>
    ({gen: fn(xs.gen), par: fn(xs.par)});

const str = (terms: Term[]): string =>
    swap_quotes(terms.map(Grammar.print_term).join(', '));

// Logic for generating a Grammar from an Env.

const add_rhs = (lhs: string, rhs: RuleNode, env: Env): void => {
  // Collect interleaved expression and punctuation terms. There will always
  // be one more punctuation term than there is expression terms.
  const expressions: {expr: ExprNode, mark: Mark, optional: boolean}[] = [];
  const punctuation: string[] = [''];
  for (const term of rhs.terms) {
    if (term.type === 'expr') {
      expressions.push(term);
      punctuation.push('');
    } else {
      punctuation.push(`${punctuation.pop()}${term.punctuation}`);
    }
  }

  // Find a central required term around which to build this rule.
  const indices = expressions.map((x, i) => !x.optional ? i : -1)
  const mid = indices.filter((x) => x >= 0)[0];
  if (mid == null) throw Error(`Null rule: ${lhs} -> ${JSON.stringify(rhs)}`);

  // Prepare to build up the gen and par rules from this RuleNode.
  const ones = gen<One>(() => ({lhs, rhs: [], slots: []}));
  const syntaxes = create_syntaxes(expressions.map((x) => x.mark));
  const two: Two = {ones, sign: rhs.sign, syntaxes};
  two.ones.gen.score = rhs.score_gen;
  two.ones.par.score = rhs.score_par;
  two.template = rhs.template;

  // Add the terms to each type of rule, then add the rule to the grammar.
  const fn = (text: string) => text ? two.ones.gen.rhs.push({text}) : 0;
  const terms = expressions.map((x) => build_term(x.expr, env));
  fn(punctuation[0]);
  for (let i = 0; i < mid; i++) {
    const text = punctuation[i + 1] || ' ';
    add_terms([terms[i], {text}], 0, expressions[i].optional, two, env);
  }
  add_terms([terms[mid]], 0, false, two, env);
  for (let i = mid + 1; i < terms.length; i++) {
    const text = punctuation[i] || ' ';
    add_terms([{text}, terms[i]], 1, expressions[i].optional, two, env);
  }
  fn(punctuation.pop()!);
  add_rule(two, env);
}

const add_rule = (two: Two, env: Env): void => {
  if (two.sign !== '<') create_rule(two, 'gen', env.result.gen);
  if (two.sign !== '>') create_rule(two, 'par', env.result.par);
}

const add_symbol = (name: string, env: Env): void => {
  // If this symbol is a root symbol, add rules from kRoot to it.
  const {root, rules} = env.exists[name];
  if (root) {
    const side = [[name], [kSpace, name, kSpace]];
    const ones: Both<One> = {
      gen: {lhs: kRoot, rhs: side[0], slots: [{index: 0, optional: false}]},
      par: {lhs: kRoot, rhs: side[1], slots: [{index: 1, optional: false}]},
    };
    const template = new Template(`{${name}: $0}`);
    add_rule({ones, sign: '=', template}, env);
  }

  // Add the regular rules from this symbol to its possible children.
  // If the symbol is a root symbol, we suffix its rules with a period.
  const period: TermNode = {type: 'punctuation', punctuation: '.'};
  rules.forEach((x) => {
    const add_period = root && x.terms[x.terms.length - 1].type === 'expr';
    const terms = add_period ? x.terms.concat([period]) : x.terms;
    add_rhs(name, {...x, terms}, env);
  });
}

const add_terms = (terms: Term[], j: number, optional: boolean,
                   two: Two, env: Env): void => {
  // Update the index-tracking metadata for this rule.
  assert(!!terms[j], () => `Invalid fragment index: ${j}`);
  const offset = optional ? 0 : j;
  two.ones.gen.slots.push({index: two.ones.gen.rhs.length + offset, optional});
  two.ones.par.slots.push({index: two.ones.par.rhs.length + offset, optional});

  // Update the generative and parsing term lists for this rule.
  if (optional) {
    const term = build_option(terms, j, env);
    two.ones.gen.rhs.push(term);
    two.ones.par.rhs.push(term);
  } else {
    for (let i = 0; i < terms.length; i++) {
      two.ones.gen.rhs.push(terms[i]);
      two.ones.par.rhs.push(i === j ? terms[i] : kSpace);
    }
  }
}

const build_binding = (name: string, token: Token, env: Env): Term => {
  if (!env.bindings[name]) throw token.error(`Unknown binding: @${name}`);
  return env.bindings[name];
}

const build_macro = (args: ExprNode[], name: string,
                     token: Token, env: Env): Term => {
  // Compute a symbol for the macro given these arguments.
  const macro = env.macros[name];
  if (!macro) throw token.error(`Unbound macro: ${name}`);
  const n = macro.args.length;
  if (args.length !== n) {
    throw token.error(`${name} got ${args.length} argments; expected: ${n}`);
  }
  const terms = args.map((x) => build_term(x, env));
  const symbol = `${name}[${str(terms)}]`;
  if (env.exists[symbol]) return symbol;

  // Add rules needed for this new macro instantiation.
  const child: Env = {...env, bindings: {}};
  terms.forEach((x, i) => child.bindings[macro.args[i]] = x);
  env.exists[symbol] = {root: false, rules: macro.rules};
  add_symbol(symbol, child);
  return symbol;
}

const build_option = (terms: Term[], j: number, env: Env): Term => {
  // Compute a symbol for this optional list of consecutive terms.
  const symbol = `(${str(terms)})?`;
  if (env.exists[symbol]) return symbol;
  env.exists[symbol] = {root: false, rules: []};

  // Add the null rules for this symbol.
  const zero = gen<One>(() => ({lhs: symbol, rhs: [], slots: []}));
  add_rule({ones: zero, sign: '='}, env);

  // Add the non-null rules for this symbol.
  const slots = [{index: j, optional: false}];
  const ones = gen<One>(() => ({lhs: symbol, rhs: [], slots}));
  const two: Two = {ones, sign: '=', template: new Template('$0')};
  terms.forEach((x, i) => {
    two.ones.gen.rhs.push(x);
    two.ones.par.rhs.push(i === j ? x : kSpace);
  });
  add_rule(two, env);
  return symbol;
}

const build_term = (expr: ExprNode, env: Env): Term => {
  switch (expr.type) {
    case 'binding': return build_binding(expr.name, expr.token, env);
    case 'macro': return build_macro(expr.args, expr.name, expr.token, env);
    case 'term': return expr.term;
  }
}

const create_rule = (two: Two, kind: Kind, grammar: Grammar): void => {
  const {lhs, rhs, score, slots} = two.ones[kind];
  const syntaxes: Syntax[] = (two.syntaxes || []).map(
      (x) => ({...x, indices: x.indices.map((y) => slots[y].index)}));
  const transform = create_transform(two, kind);
  make_rule(grammar, {lhs, rhs, score, syntaxes, transform});
}

const create_syntaxes = (marks: Mark[]): Syntax[] => {
  const indices: number[] = [];
  marks.forEach((x, i) => { if (x === '*') indices.push(i); });
  marks.forEach((x, i) => { if (x === '^') indices.push(i); });
  return indices.length === 0 ? [] : [{indices, tense: {}}];
}

const create_transform = (two: Two, kind: Kind): Function => {
  if (!two.template) return kind === 'gen' ? () => [] : () => null;
  const one = two.ones[kind];
  const template = two.template.index(one.rhs.length, one.slots);
  return template[kind === 'gen' ? 'split' : 'merge'].bind(template);
}

const make_grammar = (): Grammar => ({
  by_name: {},
  lexer: <any>null,
  max_index: 0,
  rules: [],
  start: kRoot,
});

const make_rule = (grammar: Grammar, mini: Mini): void => {
  const full = {score: mini.score || 0, syntaxes: mini.syntaxes || []};
  const rule: Rule = {...mini, ...full, index: grammar.max_index};
  (grammar.by_name[rule.lhs] = grammar.by_name[rule.lhs] || []).push(rule);
  grammar.max_index += rule.rhs.length + 1;
  grammar.rules.push(rule);
}

// Logic for parsing a Fantasy grammar file and returning an Env.

const parse_directives = (lexer: Lexer): Partial<RuleNode> => {
  const result: Partial<RuleNode> = {};
  while (lexer.maybe_match('(')) {
    // Parse the template that follows the directive sign.
    const {error, text} = lexer.next();
    const next = lexer.peek();
    if (!chr('<=>', text)) {
      throw error(`Expected: score or template; got: ${text}`);
    }
    const template = new Template(lexer);
    lexer.match(')');

    // Based on the directive sign, set the score or template.
    if (text === '=') { result.template = template; continue; }
    const score = template.index(0, []).merge([]);
    if (typeof score !== 'number' || isNaN(score)) {
      throw next.error(`Expected: score, got: ${next.text}`);
    }
    const key = text === '>' ? 'score_gen' : 'score_par';
    result[key] = score;
  }
  return result;
}

const parse_expression = (lexer: Lexer): ExprNode => {
  const token = lexer.next();
  const {error, text, type} = token;
  const base = text;
  if (text === '@' || text === '$' || text === '%') {
    const token = lexer.next();
    const {error, text, type} = token;
    if (type !== 'id') throw error(`Expected: identifier; got: ${text}`);
    if (base === '@') return {type: 'binding', name: text, token};
    return {type: 'term', term: base === '$' ? text : {type: text}, token};
  } else if (type === 'id' && lexer.maybe_match('[')) {
    const args: ExprNode[] = [];
    while (!lexer.maybe_match(']')) {
      if (args.length > 0) lexer.match(',');
      args.push(parse_expression(lexer));
    }
    return {type: 'macro', name: text, args, token};
  } else if (type === 'id') {
    return {type: 'term', term: {text}, token};
  }
  throw error(`Expected: binding, macro, symbol, or text; got: ${text}`);
}

const parse_lexer = (lexer: Lexer, env: Env): void => {
  const {error, text, type, value} = lexer.next();
  if (type !== 'block') throw error(`Expected: lexer; got: ${text}`);
  /* tslint:disable-next-line:no-eval */
  const result = eval(`(() => {${value}})()`);
  env.result.gen.lexer = result;
  env.result.par.lexer = result;
}

const parse_macro = (lexer: Lexer, token: Token, env: Env): void => {
  const text = token.text;
  if (env.macros[text]) throw token.error(`Duplicate macro: ${text}`);
  const args: string[] = [];
  for (lexer.match('['); !lexer.maybe_match(']');) {
    if (args.length > 0) lexer.match(',');
    const {error, text, type} = lexer.next();
    if (type !== 'id') throw error(`Expected: argument or ]; got: ${text}`);
    args.push(text);
  }
  const base = parse_directives(lexer);
  env.macros[text] = {args, rules: parse_rules(base, lexer)};
}

const parse_rules = (base: Partial<RuleNode>, lexer: Lexer): RuleNode[] => {
  const result: RuleNode[] = [];
  while (chr('<=>', lexer.peek().text)) {
    const sign = <Sign>lexer.next().text;
    const rule = {score_gen: 0, score_par: 0, sign, terms: parse_terms(lexer)};
    result.push({...rule, ...base, ...parse_directives(lexer)});
  }
  return result;
}

const parse_symbol = (lexer: Lexer, root: boolean, env: Env): void => {
  const {error, text, type} = lexer.next();
  if (type !== 'id') throw error(`Expected: symbol; got: ${text}`);
  if (env.exists[text]) throw error(`Duplicate symbol: ${text}`);
  const base = parse_directives(lexer);
  env.exists[text] = {root, rules: parse_rules(base, lexer)};
}

const parse_term = (lexer: Lexer): TermNode => {
  const {text, type} = lexer.peek();
  if (text !== '@' && text !== '$' && text !== '%' && type === 'sym') {
    const token = lexer.next();
    if (adjacent(token)) throw token.error(`Invalid mark: ${token.text}`);
    return {type: 'punctuation', punctuation: token.text};
  }
  const expr = parse_expression(lexer);
  const fn = (x: string) => adjacent(lexer.peek()) && lexer.maybe_match(x);
  const optional = fn('?');
  const mark = fn('*') ? '*' : fn('^') ? '^' : '-';
  return {type: 'expr', expr, mark, optional};
}

const parse_terms = (lexer: Lexer): TermNode[] => {
  const result: TermNode[] = [];
  while (!initial(lexer.peek()) && lexer.peek().text !== '(') {
    result.push(parse_term(lexer));
  }
  return result;
}

// Validation of the final grammar.

const invalid = (input: string, names: string[], type: string): Error => {
  const lexer = new Lexer(input);
  const message = `${type} symbols: ${names.map((x) => `$${x}`).join(', ')}`;
  const missing: (Token | null)[] = Array(names.length).fill(null);
  for (let token = lexer.next(); token.type !== 'eof'; token = lexer.next()) {
    const index = names.indexOf(lexer.peek().text);
    if (index < 0 || token.text !== '$') continue;
    missing[index] = lexer.peek();
  }
  const token = missing.filter((x) => !!x).shift();
  return token ? token.error(message) : Error(message);
}

const validate = (input: string, grammar: Grammar): Grammar => {
  const lhs = new Set<string>();
  const rhs = new Set<string>([grammar.start]);
  grammar.rules.forEach((x) => {
    lhs.add(x.lhs);
    x.rhs.forEach((y) => { if (typeof y === 'string') rhs.add(y); });
  });
  const dead_end = Array.from(rhs).filter((x) => !lhs.has(x)).sort();
  const unreachable = Array.from(lhs).filter((x) => !rhs.has(x)).sort();
  if (dead_end.length > 0) {
    throw invalid(input, dead_end, 'Dead-end');
  } else if (unreachable.length > 0) {
    throw invalid(input, unreachable, 'Unreachable');
  }
  return grammar;
}

// The public Fantasy interface.

const compile = (input: string): Both<Grammar> => {
  const result: Both<Grammar> = gen(make_grammar);
  const env: Env = {bindings: {}, exists: {}, macros: {}, result};

  // Build up an Env by parsing the given input.
  const lexer = new Lexer(input);
  for (let token = lexer.next(); token.type !== 'eof'; token = lexer.next()) {
    if (!initial(token)) {
      throw token.error('Lexer, macro, and rule blocks must start a line!');
    }
    if (token.type === 'id') { parse_macro(lexer, token, env); continue; }
    switch (token.text) {
      case '@': parse_lexer(lexer, env); continue;
      case '.': parse_symbol(lexer, /*root=*/true, env); continue;
      case '$': parse_symbol(lexer, /*root=*/false, env); continue;
    }
    throw token.error(`Expected: lexer, macro, or rule; got: ${token.text}`);
  }

  // Add rules for parsing whitespace, then add rules from the Env.
  const transform = () => null;
  make_rule(result.par, {lhs: kSpace, rhs: [], transform});
  make_rule(result.par, {lhs: kSpace, rhs: [kSpace, {type: '_'}], transform});
  make_rule(result.par, {lhs: kSpace, rhs: [kSpace, {type: 'w'}], transform});
  Object.keys(env.exists).forEach((x) => add_symbol(x, env));

  // Validate and return the result.
  const has_lexer = result.gen.lexer && result.par.lexer;
  if (!has_lexer) throw lexer.next().error('No lexer provided!');
  return map(result, (x) => validate(input, x));
}

const Fantasy = {compile};

export {Fantasy};
