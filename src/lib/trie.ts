interface Item<K,V> {keys: K[], value: V};
interface Memo<K,V> {dict: Map<string,number>, nodes: Trie<K,V>[]};
interface Trie<K,V> {edges: Map<K,Trie<K,V>>, values: Set<V>};

// WARNING: Calling add on an optimized Trie will cause severe correctness
// issues because of shared nodes, so we do not export it from this file.
const add = <K,V>(item: Item<K,V>, trie: Trie<K,V>) => {
  if (item.keys.length === 0) {
    trie.values.add(item.value);
    return;
  }
  const key = item.keys[0];
  if (!trie.edges.has(key)) {
    trie.edges.set(key, {edges: new Map(), values: new Set()});
  }
  add({keys: item.keys.slice(1), value: item.value}, trie.edges.get(key)!);
}

const dedupe = <K,V>(trie: Trie<K,V>, memo: Memo<K,V>): number => {
  const indices = Array.from(trie.edges.entries()).map(
      ([key, child]): [K, number] => [key, dedupe(child, memo)]);
  const id = JSON.stringify([indices.sort(), Array.from(trie.values).sort()]);
  if (!memo.dict.has(id)) {
    const node: Trie<K,V> = {edges: new Map(), values: new Set(trie.values)};
    indices.forEach(([key, i]) => node.edges.set(key, memo.nodes[i]));
    memo.dict.set(id, memo.nodes.length);
    memo.nodes.push(node);
  }
  return memo.dict.get(id)!;
}

const items = <K,V>(trie: Trie<K,V>): Item<K,V>[] => {
  const result: Item<K,V>[] = [];
  trie.values.forEach((x) => result.push({keys: [], value: x}));
  for (const [key, child] of trie.edges.entries()) {
    for (const {keys, value} of items(child)) {
      result.push({keys: [key].concat(keys), value});
    }
  }
  return result;
}

const __new__ = <K,V>(items: Item<K,V>[]): Trie<K,V> => {
  const result: Trie<K,V> = {edges: new Map(), values: new Set()};
  items.forEach((x) => add(x, result));
  return optimize(result);
}

const optimize = <K,V>(trie: Trie<K,V>): Trie<K,V> => {
  const memo = {dict: new Map(), nodes: []};
  return memo.nodes[dedupe(trie, memo)];
}

// JSON-compatible serialization for an existing trie.

type Serialized<K,V> = [[K, number][], V[]];

const deserialize = <K,V>(nodes: Serialized<K,V>[]): Trie<K,V> => {
  const tries: Trie<K,V>[] = [];
  for (const [adjacency, values] of nodes) {
    const edges = adjacency.map(
        ([key, index]): [K, Trie<K,V>] => [key, tries[index]]);
    tries.push({edges: new Map(edges), values: new Set(values)});
  }
  return tries.pop()!;
}

const serialize = <K,V>(trie: Trie<K,V>): Serialized<K,V>[] => {
  const index = new Map<Trie<K,V>,number>();
  const nodes: Serialized<K,V>[] = [];
  const visit = (node: Trie<K,V>): number => {
    if (!index.has(node)) {
      const adjacency = Array.from(node.edges).map(
          ([key, value]): [K, number] => [key, visit(value)]);
      index.set(node, nodes.length);
      nodes.push([adjacency, Array.from(node.values)]);
    }
    return index.get(node)!;
  }
  visit(trie);
  return nodes;
}

const Trie = {deserialize, items, new: __new__, serialize};

export {Trie};
