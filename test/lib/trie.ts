import {Option} from '../../src/lib/base';
import {Trie} from '../../src/lib/trie';
import {Test} from '../test';

type Item<V> = [string[], V];

const length = <K,V>(trie: Trie<K,V>): number => {
  // Subtract one to account for the initial dummy node in these tries.
  return trie.serialize()[0].length - 1;
}

const serde = <K,V>(trie: Trie<K,V>): Trie<K,V> => {
  const serialized = JSON.stringify(trie.serialize());
  return Trie.deserialize(JSON.parse(serialized));
}

const subsets = <T>(values: T[]): T[][] => {
  if (values.length === 0) return [[]];
  const child = subsets(values.slice(1));
  return child.concat(child.map((x) => [values[0]].concat(x)));
}

const trie: Test = {
  all_entries_included: () => {
    const keys = subsets(Array.from('abcde'));
    const trie = new Trie(keys.map((x): Item<boolean> => ([x, true])));
    keys.forEach((x) => Test.assert_eq(trie.get(x), [true]));
    Test.assert_eq(trie.entries().length, 32);
    Test.assert_eq(trie.get('ba'), []);
  },
  all_entries_preserved_by_serialize: () => {
    const keys = subsets(Array.from('abcde'));
    const trie = new Trie(keys.map((x): Item<boolean> => ([x, true])));
    keys.forEach((x) => Test.assert_eq(trie.get(x), [true]));
    Test.assert_eq(trie.entries().length, 32);
    Test.assert_eq(trie.get('ba'), []);
  },
  compression_yields_fewer_nodes: () => {
    const keys = subsets(Array.from('abcde'));
    const base = new Trie(keys.map((x): Item<boolean> => ([x, true])));
    const trie = serde(base);
    Test.assert_eq(length(base), 6);
    Test.assert_eq(length(trie), 6);
  },
  compression_handles_varied_keys: () => {
    const keys = subsets(Array.from('abcde'));
    const base = new Trie(keys.map((x): Item<number> => ([x, x.length % 2])));
    const trie = serde(base);
    Test.assert_eq(length(base), 10);
    Test.assert_eq(length(trie), 10);
  },
  dynamic_updates_work: () => {
    const old_keys = subsets(Array.from('abcde'));
    const new_keys = subsets(Array.from('abcd'));
    const trie = new Trie(old_keys.map((x): Item<boolean> => ([x, true])));
    new_keys.forEach((x) => Test.assert_eq(trie.get(x.concat('e')), [true]));
    new_keys.forEach((x) => Test.assert_eq(trie.get(x), [true]));
    Test.assert_eq(trie.entries().length, 32);
    Test.assert_eq(length(trie), 6);

    new_keys.map((x) => trie.add(x, false));
    new_keys.forEach((x) => Test.assert_eq(trie.get(x.concat('e')), [true]));
    new_keys.forEach((x) => Test.assert_eq(trie.get(x), [false, true]));
    Test.assert_eq(trie.entries().length, 48);
    Test.assert_eq(length(trie), 54);

    trie.compress();
    new_keys.forEach((x) => Test.assert_eq(trie.get(x.concat('e')), [true]));
    new_keys.forEach((x) => Test.assert_eq(trie.get(x), [false, true]));
    Test.assert_eq(trie.entries().length, 48);
    Test.assert_eq(length(trie), 6);
  },
  read_methods_work: () => {
    const keys = subsets(Array.from('abcde'));
    const trie = new Trie(keys.map((x): Item<number> => ([x, x.length % 2])));
    const entries = keys.sort().map((x) => [x, x.length % 2]);
    Test.assert_eq<any>(entries, trie.entries());
    Test.assert_eq(trie.entries().length, 32);
  },
};

export {trie};
