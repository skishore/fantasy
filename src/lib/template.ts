import {assert} from './base';
import {Lexer, Token} from './lexer';

interface Assignment {[index: number]: Value};

type Primitive = boolean | number | string;

interface Slot {index: number, optional: boolean};

interface TemplateList extends Array<TemplateItem> {};
interface TemplateVariable {index: number, optional: boolean, token?: Token};
type TemplateItem = TemplateVariable | [string, TemplateData];
type TemplateData = Primitive | TemplateList | TemplateVariable;

interface ValueDict {[index: string]: Value};
interface ValueList extends Array<Value> {};
type Value = null | Primitive | ValueDict | ValueList;

const apply = (template: TemplateData, subs: Value[]): Value => {
  if (template instanceof Array) {
    return apply_list(template, subs);
  } else if (typeof template === 'object') {
    return apply_variable(template, subs);
  } else {
    return template;
  }
};

const apply_list = (items: TemplateItem[], subs: Value[]): Value => {
  const elements: [string, Value][] = [];
  for (const item of items) {
    if (item instanceof Array) {
      const child = apply(item[1], subs);
      if (child !== null) elements.push([item[0], child]);
    } else {
      const child = apply_variable(item, subs);
      if (typeof child !== 'object') {
        throw Error(`Failed to merge variable: ${JSON.stringify(child)}`);
      }
      explode(child).forEach((x) => elements.push(x));
    }
  }
  return implode(elements);
}

const apply_variable = (variable: TemplateVariable, subs: Value[]): Value => {
  assert(0 <= variable.index && variable.index < subs.length);
  return subs[variable.index];
}

// Returns a list of assignments of the `balls` balls to the `bins` bins.
// Each asssignment is a sorted list of `balls` indices into [0, `bins`).
const balls_and_bins = (balls: number, bins: number): number[][] => {
  if (balls === 0) return [[]];
  const result = [];
  for (const binning of balls_and_bins(balls - 1, bins)) {
    for (let i = binning[balls - 2] || 0; i < bins; i++) {
      result.push(binning.concat([i]));
    }
  }
  return result;
}

const cross = (xs: Assignment[], ys: Assignment[]): Assignment[] => {
  const result = [];
  for (const x of xs) {
    for (const y of ys) {
      result.push({...x, ...y});
    }
  }
  return result;
}

const divide_free_keys = (items: TemplateItem[], free: string[],
                          base: string[][], n?: number): string[][][] => {
  n = n || 0;
  if (n === free.length) return [base];
  const key = free[n];

  // Compute a list of item indices where the current key could end up.
  const bins: number[] = [];
  items.forEach((item, i) => {
    if (item instanceof Array) {
      if (item[0] !== key) return;
      if (key === '_' && base[i].length > 0) return;
    }
    bins.push(i);
  });
  if (bins.length === 0) return [];

  // Handle duplicate keys, which will appear together in the free keys list.
  let m = n; while (m < free.length && free[m] === free[n]) m += 1;
  const binnings = balls_and_bins(m - n, bins.length);

  const result: string[][][] = [];
  for (const child of divide_free_keys(items, free, base, m)) {
    for (const binning of binnings) {
      if (binning.some((x, i) => {
        const item = items[bins[x]];
        return key === '_' && binning[i + 1] === x && item instanceof Array;
      })) continue;
      const option = child.slice();
      binning.forEach((x) => option[bins[x]] = [key].concat(option[bins[x]]));
      result.push(option);
    }
  }
  return result;
}

const explode = (value: null | ValueDict | ValueList): [string, Value][] => {
  if (!value) return [];
  if (value instanceof Array) {
    return value.map((x): [string, Value] => ['_', x]);
  }
  const result: [string, Value][] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v instanceof Array) {
      v.forEach((x) => result.push([k, [x]]));
    } else {
      result.push([k, v]);
    }
  }
  return result;
}

const generate = (template: TemplateData, value: Value): Assignment[] => {
  if (template instanceof Array) {
    if (typeof value !== 'object') return [];
    // Blow the value up into a list of rendered TemplateItem elements.
    const elements = explode(value);
    const elements_by_key: {[key: string]: Value[]} = {};
    elements.forEach((x) => {
      elements_by_key[x[0]] = elements_by_key[x[0]] || [];
      elements_by_key[x[0]].push(x[1]);
    });

    // As an optimization, preassign elements to required children by key.
    const base: string[][] = template.map(() => []);
    const counts: {[key: string]: number} = {};
    elements.forEach((x) => counts[x[0]] = (counts[x[0]] || 0) + 1);
    for (let i = 0; i < template.length; i++) {
      const item = template[i];
      if (item instanceof Array && !optional(item[1])) {
        if (!counts[item[0]]) return [];
        base[i].push(item[0]);
        counts[item[0]] -= 1;
      }
    }

    // Compute the multiset of element keys that are still free, then build a
    // list of options for allocating these free keys to template items.
    const free: string[] = [];
    Object.entries(counts).forEach(
        ([k, v]) => Array(v).fill(k).forEach((y) => free.push(y)));
    const options = divide_free_keys(template, free, base);

    // Return assignment candidates for each key allocation option.
    const result: {[index: number]: Value}[] = [];
    for (const option of options) {
      assert(option.length === template.length);
      const values = group(option, elements_by_key);
      assert(values.length === template.length);
      const parts = template.map((item, i) => {
        // For each item, we compute the variable assignment implied by that
        // particular item and merge it into the overall assignment candidate.
        if (!(item instanceof Array)) return generate(item, values[i]);
        assert(typeof values[i] === 'object');
        const value = values[i] ? item[0] === '_' ?
            (<any>values[i])[0] : (<any>values[i])[item[0]] : null;
        return generate(item[1], value);
      });
      parts.reduce(cross, [{}]).forEach((x) => result.push(x));
    }
    return result;
  } else if (typeof template === 'object') {
    if (value === null && !template.optional) return [];
    return [{[template.index]: value}];
  } else {
    return (value === template) ? [{}] : [];
  }
}

const group = (option: string[][], xs: {[key: string]: Value[]}): Value[] => {
  const counts: {[key: string]: number} = {};
  const assignment: [string, Value][][] = [];
  for (const keys of option) {
    assignment.push([]);
    for (const key of keys) {
      const index = counts[key] || 0;
      assignment[assignment.length - 1].push([key, xs[key][index]]);
      counts[key] = index + 1;
    }
  }
  assert(Object.entries(xs).every(([k, v]) => counts[k] === v.length));
  return assignment.map(implode);
}

const implode = (elements: [string, Value][]): Value => {
  const dict: ValueDict & {_?: ValueList} = {};
  // When inserting a key into the dict, we overwrite singular values in the
  // resulting dict but we append to list values.
  for (const [key, element] of elements) {
    const value = key === '_' ? [element] : element;
    const array = value instanceof Array;
    const present = dict.hasOwnProperty(key);
    const unmergeable = (message: string): Error =>
        Error(`Failed to merge ${value} into ${dict[key]}: ${message}`);
    if (present && dict[key] instanceof Array) {
      if (!array) throw unmergeable('singleton cannot merge with list.');
      (<ValueList>value).forEach((x) => (<ValueList>dict[key]).push(x));
    } else {
      if (present && array) {
        throw unmergeable('list cannot merge with singleton.');
      }
      dict[key] = array ? (<ValueList>value).slice() : value;
    }
  }
  // We must either have a single '_' array key or any number of other keys.
  const num = Object.keys(dict).length;
  if (num > 1 && dict._) throw Error('Failed to merge dict and list.');
  return num === 0 ? null : dict._ || dict;
}

const optional = (template: TemplateData): boolean => {
  if (template instanceof Array) {
    return template.every((x) => x instanceof Array ?
        optional(x[1]) : x.optional);
  } else if (typeof template === 'object') {
    return template.optional;
  }
  return true;
}

// Logic for parsing template expressions.

const kExpected = 'Expected: primitive, list or dictionary, got: ';

const parse_literal = (lexer: Lexer, token: Token): TemplateData => {
  const {text, type} = token;
  if (text === 'false' || text === 'true') return text === 'true';
  if (text === '$') return parse_variable(lexer);
  if (type === 'num') return parseFloat(text);
  if (type === 'str') return token.value;
  throw token.error(`${kExpected}${text}`);
}

const parse_recursive = (lexer: Lexer, token: Token): TemplateList => {
  // Deal with trivial cases: error on unused braces, and return on empty.
  const {text, type} = token;
  const result: TemplateList = [];
  if (text !== '[' && text !== '{') {
    throw token.error(`${kExpected}${text}`);
  } else if (lexer.peek().type === 'close') {
    lexer.next();
    return result;
  }

  while (true) {
    if (lexer.maybe_match('.')) {
      // Spreads can appear in both lists and dictionaries.
      Array.from('..$').forEach((x) => lexer.match(x));
      result.push(parse_variable(lexer));
    } else if (text === '[') {
      // Square braces are used to construct list-valued TemplateLists.
      result.push(['_', parse_template(lexer)]);
    } else if (text === '{') {
      // Curly braces are used to construct dict-valued TemplateLists.
      const key = lexer.next();
      if (key.type !== 'id' && key.type !== 'str' ||
          key.value === '' || key.value === '_') {
        throw key.error(`Invalid template key: ${key}`);
      }
      lexer.match(':');
      result.push([key.value, parse_template(lexer)]);
    }

    // Break when we've found the end of the recursive template.
    const next = lexer.next();
    if (next.type === 'close') break;
    if (next.text !== ',') throw next.error(`Expected: ,; got: ${next.text}`);
  }
  return result;
}

const parse_template = (lexer: Lexer): TemplateData => {
  const token = lexer.next();
  switch (token.type) {
    case 'block': throw token.error(`${kExpected}%block`);
    case 'close': throw token.error(`${kExpected}${token.value}`);
    case 'eof': throw token.error(`${kExpected}${token.value}`);
    case 'id': return parse_literal(lexer, token);
    case 'num': return parse_literal(lexer, token);
    case 'open': return parse_recursive(lexer, token);
    case 'str': return parse_literal(lexer, token);
    case 'sym': return parse_literal(lexer, token);
  }
}

const parse_variable = (lexer: Lexer): TemplateVariable => {
  const token = lexer.next();
  const index = parseFloat(token.text);
  if (token.type !== 'num' || index % 1 !== 0) {
    throw token.error(`Expected: index, got: ${token.text}`);
  }
  return {index, optional: true, token};
}

const reindex = (template: TemplateData, slots: Slot[]): TemplateData => {
  if (template instanceof Array) {
    const fn = (x: TemplateData): any => reindex(x, slots);
    return template.map((x) => x instanceof Array ? [x[0], fn(x[1])] : fn(x));
  } else if (typeof template === 'object') {
    if (!(0 <= template.index && template.index < slots.length)) {
      const message = `Index out of bounds: $${template.index}`;
      throw (template.token ? template.token.error : Error)(message);
    }
    return slots[template.index];
  } else {
    return template;
  }
}

// The public interface of this file.

class Template {
  private data: TemplateData;
  private size: number;
  constructor(input: Lexer | string) {
    const lexer = typeof input === 'string' ? new Lexer(input) : input;
    this.data = parse_template(lexer);
    this.size = -1;
  }
  index(size: number, slots: Slot[]): Template {
    const data = reindex(this.data, slots);
    return Object.assign(new Template('[]'), {data, size});
  }
  merge(subs: Value[]): Value {
    assert(this.size < 0 || subs.length === this.size,
           () => `Expected: ${this.size} subs; got: ${subs.length}`);
    return apply(this.data, subs);
  }
  split(value: Value): Assignment[] {
    return generate(this.data, value);
  }
};

export {Assignment, Template, Value};
