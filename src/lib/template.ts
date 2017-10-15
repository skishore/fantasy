import {assert} from './base';
import {Grammar} from '../parsing/grammar';
import {Lexer} from '../parsing/lexer';
import {Parser} from '../parsing/parser';

interface Assignment {[index: number]: Value};

type Primitive = boolean | number | string;

interface TemplateList extends Array<TemplateItem> {};
interface TemplateVariable {index: number, optional: boolean};
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
      result.push(Object.assign({}, x, y));
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
  } else if (typeof template === "object") {
    return template.optional;
  }
  return true;
}

// Load the grammar used to parse template expressions.

const [grammar, lexer] = Grammar.from_file('../../src/dsl/template.js');

const validate = (template: TemplateData, optional: boolean[]): void => {
  if (template instanceof Array) {
    return template.forEach((x) => x instanceof Array ?
        validate(x[1], optional) : validate(x, optional));
  } else if (typeof template === 'object') {
    if (!(0 <= template.index && template.index < optional.length)) {
      throw new Error(`Index out of bounds: $${template.index}`);
    }
    template.optional = optional[template.index];
  }
}

class Template {
  private data: TemplateData;
  private size: number;
  constructor(input: string, optional?: boolean[]) {
    optional = optional || [];
    const parser = new Parser(grammar);
    Array.from(lexer.iterable(input)).forEach((x) => parser.feed(x));
    this.data = parser.result();
    this.size = optional.length;
    validate(this.data, optional);
  }
  apply(subs: Value[]): Value {
    if (subs.length !== this.size) throw new Error(
        `Expected: ${this.size} subs; got: ${subs.length}`);
    return apply(this.data, subs);
  }
  generate(value: Value): Assignment[] {
    return generate(this.data, value);
  }
};

export {Assignment, Template, Value};
