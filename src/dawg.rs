// "DAWG" stands for "deterministic acyclic word graph", similar to a trie.
// Unlike a trie, the edges of a DAWG can form an arbitrary directed acyclic
// graph and paths can share nodes. Compress minimizes the number of nodes.

use arena::Arena;
use rustc_hash::{FxHashMap, FxHashSet};
use std::hash::Hash;

pub trait Item: Clone + Eq + Hash + Ord {}

impl<T: Clone + Eq + Hash + Ord> Item for T {}

pub struct Dawg<K: Item, V: Item> {
  data: Vec<Node<K, V>>,
  edge_arena: Arena<FxHashMap<K, usize>>,
  node_arena: Arena<FxHashSet<V>>,
}

struct Memo<K: Item, V: Item> {
  dawg: Dawg<K, V>,
  memo: FxHashMap<(Vec<(K, usize)>, Vec<V>), usize>,
}

#[derive(Clone)]
struct Node<K: Item, V: Item> {
  edges: Option<*mut FxHashMap<K, usize>>,
  nodes: Option<*mut FxHashSet<V>>,
}

impl<K: Item, V: Item> Dawg<K, V> {
  pub fn new(items: &[(&[K], V)]) -> Self {
    let mut dawg = Self {
      data: vec![Node { edges: None, nodes: None }],
      edge_arena: Arena::with_capacity(items.len()),
      node_arena: Arena::with_capacity(items.len()),
    };
    items.iter().for_each(|(k, v)| dawg.add(k, v));
    dawg
  }

  pub fn add(&mut self, keys: &[K], value: &V) {
    let size = self.size();
    self.add_helper(size, keys, value);
  }

  pub fn compress(&self) -> Self {
    let mut memo = Memo { dawg: Self::new(&[]), memo: FxHashMap::default() };
    self.compress_helper(self.size(), &mut memo);
    memo.dawg
  }

  pub fn entries(&self) -> Vec<(Vec<K>, V)> {
    let mut result = self.entries_helper(self.size());
    result.iter_mut().for_each(|(k, _)| k.reverse());
    result
  }

  pub fn get(&self, keys: &[K]) -> Vec<V> {
    let mut prev = self.size();
    for k in keys.iter() {
      if let Some(next) = self.data[prev].edges.and_then(|x| unsafe { &*x }.get(k)) {
        prev = *next;
      } else {
        return vec![];
      }
    }
    let nodes = self.data[prev].nodes;
    nodes.map(|x| unsafe { &*x }.iter().map(|x| x.clone()).collect()).unwrap_or_default()
  }

  pub fn size(&self) -> usize {
    self.data.len() - 1
  }

  fn add_helper(&mut self, i: usize, keys: &[K], value: &V) -> usize {
    if keys.is_empty() {
      if self.data[i].nodes.map_or(false, |x| unsafe { &*x }.contains(&value)) {
        return i;
      }
      let mut entry = self.data[i].clone();
      let mut nodes = entry.nodes.map(|x| unsafe { &*x }.clone()).unwrap_or_default();
      nodes.insert(value.clone());
      entry.nodes.replace(self.node_arena.alloc(nodes));
      self.data.push(entry);
      return self.data.len() - 1;
    }
    let (head, tail) = (&keys[0], &keys[1..]);
    let index = self.data[i].edges.and_then(|x| unsafe { &*x }.get(head).cloned()).unwrap_or(0);
    let child = self.add_helper(index, tail, value);
    if child == index {
      return i;
    }
    let mut entry = self.data[i].clone();
    let mut edges = entry.edges.map(|x| unsafe { &*x }.clone()).unwrap_or_default();
    edges.insert(head.clone(), child);
    entry.edges.replace(self.edge_arena.alloc(edges));
    self.data.push(entry);
    self.data.len() - 1
  }

  fn compress_helper(&self, i: usize, memo: &mut Memo<K, V>) -> usize {
    let entry = &self.data[i];
    let (mut edges, mut nodes): (Vec<_>, Vec<_>) = {
      let f = |(k, i): (&K, &usize)| (k.clone(), self.compress_helper(*i, memo));
      let g = |x: &V| x.clone();
      let edges = entry.edges.map(|x| unsafe { &*x }.iter().map(f).collect()).unwrap_or_default();
      let nodes = entry.nodes.map(|x| unsafe { &*x }.iter().map(g).collect()).unwrap_or_default();
      (edges, nodes)
    };
    (edges.sort(), nodes.sort());
    let new_index = memo.dawg.data.len();
    let result = *memo.memo.entry((edges.clone(), nodes.clone())).or_insert(new_index);
    if result == new_index {
      let edges = if edges.is_empty() {
        None
      } else {
        let new = memo.dawg.edge_arena.alloc(FxHashMap::default());
        edges.into_iter().for_each(|(k, i)| std::mem::drop(new.insert(k, i)));
        Some(new as *mut _)
      };
      let nodes = if nodes.is_empty() {
        None
      } else {
        let new = memo.dawg.node_arena.alloc(FxHashSet::default());
        nodes.into_iter().for_each(|x| std::mem::drop(new.insert(x)));
        Some(new as *mut _)
      };
      memo.dawg.data.push(Node { edges, nodes });
    }
    result
  }

  fn entries_helper(&self, i: usize) -> Vec<(Vec<K>, V)> {
    let mut result = vec![];
    if let Some(edges) = self.data[i].edges {
      for (k, i) in unsafe { &*edges } {
        self.entries_helper(*i).into_iter().for_each(|(mut keys, value)| {
          keys.push(k.clone());
          result.push((keys, value));
        });
      }
    }
    if let Some(nodes) = self.data[i].nodes {
      unsafe { &*nodes }.iter().for_each(|x| result.push((vec![], x.clone())));
    }
    result
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  fn dawg<K: Item, V: Item>(keys: &Vec<(Vec<K>, V)>) -> Dawg<K, V> {
    let items: Vec<_> = keys.iter().map(|(k, v)| (k.as_slice(), v.clone())).collect();
    Dawg::new(items.as_slice())
  }

  fn subsets<T: Clone>(xs: &[T]) -> Vec<Vec<T>> {
    if xs.is_empty() {
      vec![vec![]]
    } else {
      let mut ys = subsets(&xs[1..]);
      let zs: Vec<_> = ys
        .iter()
        .map(|y| {
          let mut z = vec![xs[0].clone()];
          z.extend_from_slice(y);
          z
        })
        .collect();
      ys.extend(zs);
      ys
    }
  }

  #[test]
  fn all_entries_included() {
    let keys = subsets("abcde".as_bytes()).into_iter().map(|x| (x, true)).collect();
    let dawg = dawg(&keys);
    keys.iter().for_each(|(k, _)| assert_eq!(dawg.get(k.as_slice()), vec![true]));
    assert_eq!(dawg.entries().len(), 32);
    assert_eq!(dawg.get("ac".as_bytes()), vec![true]);
    assert_eq!(dawg.get("ca".as_bytes()), vec![]);
    assert_eq!(dawg.get("abc".as_bytes()), vec![true]);
    assert_eq!(dawg.get("cab".as_bytes()), vec![]);
    assert!(dawg.size() >= 32);
  }

  #[test]
  fn compression_yields_fewer_nodes() {
    let keys = subsets("abcde".as_bytes()).into_iter().map(|x| (x, true)).collect();
    let dawg = dawg(&keys).compress();
    keys.iter().for_each(|(k, _)| assert_eq!(dawg.get(k.as_slice()), vec![true]));
    assert_eq!(dawg.entries().len(), 32);
    assert_eq!(dawg.get("ac".as_bytes()), vec![true]);
    assert_eq!(dawg.get("ca".as_bytes()), vec![]);
    assert_eq!(dawg.get("abc".as_bytes()), vec![true]);
    assert_eq!(dawg.get("cab".as_bytes()), vec![]);
    assert_eq!(dawg.size(), 6);
  }

  #[test]
  fn compression_handles_varied_values() {
    let keys = subsets("abcde".as_bytes()).into_iter().map(|x| (x.clone(), x.len() % 2)).collect();
    let dawg = dawg(&keys).compress();
    keys.iter().for_each(|(k, _)| assert_eq!(dawg.get(k.as_slice()), vec![k.len() % 2]));
    assert_eq!(dawg.entries().len(), 32);
    assert_eq!(dawg.get("ac".as_bytes()), vec![0]);
    assert_eq!(dawg.get("ca".as_bytes()), vec![]);
    assert_eq!(dawg.get("abc".as_bytes()), vec![1]);
    assert_eq!(dawg.get("cab".as_bytes()), vec![]);
    assert_eq!(dawg.size(), 10);
  }

  #[bench]
  fn dawg_benchmark(b: &mut Bencher) {
    // TODO(skishore): Try out a getter benchmark on a compressed DAWG here.
  }
}
