interface Data<K,V> {edges: (Map<K,number>|null)[], nodes: (Set<V>|null)[]};
interface Memo<K,V> {data: Data<K,V>, dict: Map<string,number>};

type Item<K,V> = [Iterable<K>, V];
type Serialized<K,V> = [([K, number][] | null)[], (V[] | null)[]];

const add = <K,V>(data: Data<K,V>, i: number, keys: K[], value: V): number => {
  if (keys.length === 0) {
    const set = data.nodes[i];
    if (set && set.has(value)) return i;
    const result = share(data, i);
    (data.nodes[result] = set ? new Set(set) : new Set()).add(value);
    return result;
  }
  const map = data.edges[i];
  const [head, tail] = [keys[0], keys.slice(1)];
  const index = (map && map.get(head)) || 0;
  const child = add(data, index, tail, value);
  if (child === index) return i;
  const result = share(data, i);
  (data.edges[result] = map ? new Map(map) : new Map()).set(head, child);
  return result;
}

const dedupe = <K,V>(data: Data<K,V>, i: number, memo: Memo<K,V>): number => {
  const [map, set] = [data.edges[i], data.nodes[i]];
  const edges = map && Array.from(map.entries()).map(
      ([key, child]): [K, number] => [key, dedupe(data, child, memo)]).sort();
  const nodes = set && Array.from(set).sort();
  const id = JSON.stringify([edges, nodes]);
  if (!memo.dict.has(id)) {
    memo.data.edges.push(edges && new Map(edges));
    memo.data.nodes.push(nodes && new Set(nodes));
    memo.dict.set(id, memo.data.edges.length - 1);
  }
  return memo.dict.get(id)!;
}

const empty = <K,V>(): Data<K,V> => ({edges: [null], nodes: [null]});

const items = <K,V>(data: Data<K,V>, i: number): Item<K,V>[] => {
  const [map, set] = [data.edges[i], data.nodes[i]];
  const nodes = Array.from(set || new Set<V>()).sort();
  const result = nodes.map((x): Item<K,V> => ([[], x]));
  for (const [key, child] of Array.from(map || new Map<K,number>()).sort()) {
    for (const [keys, value] of items(data, child)) {
      result.push([[key].concat(Array.from(keys)), value]);
    }
  }
  return result;
}

const share = <K,V>(data: Data<K,V>, i: number): number => {
  data.edges.push(data.edges[i]);
  data.nodes.push(data.nodes[i]);
  return data.edges.length - 1;
}

// The public interface of this file is an easy-to-use class.

class Trie<K,V> {
  private data: Data<K,V>;
  constructor(items?: Item<K,V>[]) {
    this.data = empty();
    (items || []).forEach(([k, v]) => this.add(k, v));
    this.compress();
  }
  add(keys: Iterable<K>, value: V) {
    const i = this.data.edges.length - 1;
    add(this.data, i, Array.from(keys), value);
  }
  compress() {
    const memo: Memo<K,V> = {data: empty(), dict: new Map()};
    dedupe(this.data, this.data.edges.length - 1, memo);
    this.data = memo.data;
  }
  entries(): Item<K,V>[] {
    return items(this.data, this.data.edges.length - 1);
  }
  get(keys: Iterable<K>): V[] {
    let current = this.data.edges.length - 1;
    for (const key of keys) {
      const edges = this.data.edges[current];
      const next = edges && edges.get(key);
      if (!next) return [];
      current = next;
    }
    const nodes = this.data.nodes[current];
    return nodes ? Array.from(nodes).sort() : [];
  }
  serialize(): Serialized<K,V> {
    const edges = this.data.edges.map((x) => x && Array.from(x));
    const nodes = this.data.nodes.map((x) => x && Array.from(x));
    return [edges, nodes];
  }
  static deserialize<K,V>(serialized: Serialized<K,V>): Trie<K,V> {
    const trie = new Trie<K,V>();
    trie.data.edges = serialized[0].map((x) => x && new Map(x));
    trie.data.nodes = serialized[1].map((x) => x && new Set(x));
    return trie;
  }
}

export {Trie};
