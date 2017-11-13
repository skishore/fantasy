import {Option} from '../../src/lib/base';
import {Trie} from '../../src/lib/trie';
import {Test} from '../test';

const length = <K,V>(trie: Trie<K,V>): number => {
  return Trie.serialize(trie).length;
}

const serde = <K,V>(trie: Trie<K,V>): Trie<K,V> => {
  const serialized = JSON.stringify(Trie.serialize(trie));
  return Trie.deserialize(JSON.parse(serialized));
}

const subsets = <T>(values: T[]): T[][] => {
  if (values.length === 0) return [[]];
  const child = subsets(values.slice(1));
  return child.concat(child.map((x) => [values[0]].concat(x)));
}

const values = <K,V>(trie: Trie<K,V>, keys: K[]): Option<V[]> => {
  if (keys.length === 0) return {some: Array.from(trie.values)};
  const node = trie.edges.get(keys[0]);
  return node ? values(node, keys.slice(1)) : null;
}

const trie: Test = {
  trie_includes_all_keys: () => {
    const keys = subsets(Array.from('abcde'));
    const trie = Trie.new(keys.map((x) => ({keys: x, value: true})));
    keys.forEach((x) => Test.assert_eq(values(trie, x), {some: [true]}));
    Test.assert_eq(values(trie, ['b', 'a']), null);
  },
  trie_serialization_works: () => {
    const keys = subsets(Array.from('abcde'));
    const trie = serde(Trie.new(keys.map((x) => ({keys: x, value: true}))));
    keys.forEach((x) => Test.assert_eq(values(trie, x), {some: [true]}));
    Test.assert_eq(values(trie, ['b', 'a']), null);
  },
  trie_optimization_works: () => {
    const keys = subsets(Array.from('abcde'));
    const base = Trie.new(keys.map((x) => ({keys: x, value: true})));
    const trie = serde(base);
    Test.assert_eq(length(base), 6);
    Test.assert_eq(length(trie), 6);
  },
  trie_optimization_handles_varied_keys: () => {
    const keys = subsets(Array.from('abcde'));
    const base = Trie.new(keys.map((x) => ({keys: x, value: x.length % 2})));
    const trie = serde(base);
    Test.assert_eq(length(base), 10);
    Test.assert_eq(length(trie), 10);
  },
};

export {trie};
