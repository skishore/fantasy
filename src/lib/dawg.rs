// "DAWG" stands for "deterministic acyclic word graph", similar to a trie.
// Unlike a trie, the edges of a DAWG can form an arbitrary directed acyclic
// graph and paths can share nodes. Compress minimizes the number of nodes.

use super::super::lib::base::{HashMap, HashSet};
use std::hash::Hash;
use std::rc::Rc;

pub trait Item: Clone + Eq + Hash + Ord {}

impl<T: Clone + Eq + Hash + Ord> Item for T {}

pub struct Dawg<K: Item, V: Item> {
  data: Vec<Node<K, V>>,
}

struct Memo<K: Item, V: Item> {
  dawg: Dawg<K, V>,
  memo: HashMap<(Vec<(K, usize)>, Vec<V>), usize>,
}

#[derive(Clone)]
struct Node<K: Item, V: Item> {
  edges: Option<Rc<HashMap<K, usize>>>,
  nodes: Option<Rc<HashSet<V>>>,
}

impl<K: Item, V: Item> Dawg<K, V> {
  pub fn new(items: &[(&[K], V)]) -> Self {
    let mut dawg = Self { data: vec![Node { edges: None, nodes: None }] };
    items.iter().for_each(|(k, v)| dawg.add(k, v));
    dawg
  }

  pub fn add(&mut self, keys: &[K], value: &V) {
    let size = self.size();
    self.add_helper(size, keys, value);
  }

  pub fn compress(&self) -> Self {
    let mut memo = Memo { dawg: Self::new(&[]), memo: HashMap::default() };
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
      if let Some(next) = self.data[prev].edges.as_ref().and_then(|x| x.get(k)) {
        prev = *next;
      } else {
        return vec![];
      }
    }
    let nodes = &self.data[prev].nodes;
    nodes.as_ref().map(|x| x.iter().cloned().collect()).unwrap_or_default()
  }

  pub fn size(&self) -> usize {
    self.data.len() - 1
  }

  fn add_helper(&mut self, i: usize, keys: &[K], value: &V) -> usize {
    if keys.is_empty() {
      if self.data[i].nodes.as_ref().map_or(false, |x| x.contains(value)) {
        return i;
      }
      let mut entry = self.data[i].clone();
      let mut nodes = entry.nodes.as_ref().map(|x| (**x).clone()).unwrap_or_default();
      nodes.insert(value.clone());
      entry.nodes.replace(Rc::new(nodes));
      self.data.push(entry);
      return self.data.len() - 1;
    }
    let (head, tail) = (&keys[0], &keys[1..]);
    let index = self.data[i].edges.as_ref().and_then(|x| x.get(head).cloned()).unwrap_or(0);
    let child = self.add_helper(index, tail, value);
    if child == index {
      return i;
    }
    let mut entry = self.data[i].clone();
    let mut edges = entry.edges.as_ref().map(|x| (**x).clone()).unwrap_or_default();
    edges.insert(head.clone(), child);
    entry.edges.replace(Rc::new(edges));
    self.data.push(entry);
    self.data.len() - 1
  }

  fn compress_helper(&self, i: usize, memo: &mut Memo<K, V>) -> usize {
    let entry = &self.data[i];
    let (mut edges, mut nodes): (Vec<_>, Vec<_>) = {
      let f = |(k, i): (&K, &usize)| (k.clone(), self.compress_helper(*i, memo));
      let g = |x: &V| x.clone();
      let edges = entry.edges.as_ref().map(|x| x.iter().map(f).collect()).unwrap_or_default();
      let nodes = entry.nodes.as_ref().map(|x| x.iter().map(g).collect()).unwrap_or_default();
      (edges, nodes)
    };
    edges.sort();nodes.sort();
    let new_index = memo.dawg.data.len();
    let result = *memo.memo.entry((edges.clone(), nodes.clone())).or_insert(new_index);
    if result == new_index {
      let edges = if edges.is_empty() {
        None
      } else {
        let mut new = HashMap::default();
        edges.into_iter().for_each(|(k, i)| std::mem::drop(new.insert(k, i)));
        Some(Rc::new(new))
      };
      let nodes = if nodes.is_empty() {
        None
      } else {
        let mut new = HashSet::default();
        nodes.into_iter().for_each(|x| std::mem::drop(new.insert(x)));
        Some(Rc::new(new))
      };
      memo.dawg.data.push(Node { edges, nodes });
    }
    result
  }

  fn entries_helper(&self, i: usize) -> Vec<(Vec<K>, V)> {
    let mut result = vec![];
    if let Some(edges) = &self.data[i].edges {
      for (k, i) in edges.iter() {
        self.entries_helper(*i).into_iter().for_each(|(mut keys, value)| {
          keys.push(k.clone());
          result.push((keys, value));
        });
      }
    }
    if let Some(nodes) = &self.data[i].nodes {
      nodes.iter().for_each(|x| result.push((vec![], x.clone())));
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
    Dawg::new(&items)
  }

  fn subsets<T: Clone>(xs: &[T]) -> Vec<Vec<T>> {
    if xs.is_empty() {
      return vec![vec![]];
    }
    let (head, tail) = xs.split_at(1);
    let ys = subsets(tail);
    ys.iter().map(|y| head.iter().chain(y).cloned().collect()).chain(ys.clone()).collect()
  }

  #[test]
  fn all_entries_included() {
    let keys = subsets(b"abcde").into_iter().map(|x| (x, true)).collect();
    let dawg = dawg(&keys);
    keys.iter().for_each(|(k, _)| assert_eq!(dawg.get(k), vec![true]));
    assert_eq!(dawg.entries().len(), 32);
    assert_eq!(dawg.get(b"ac"), vec![true]);
    assert_eq!(dawg.get(b"ca"), vec![]);
    assert_eq!(dawg.get(b"abc"), vec![true]);
    assert_eq!(dawg.get(b"cab"), vec![]);
    assert!(dawg.size() >= 32);
  }

  #[test]
  fn compression_yields_fewer_nodes() {
    let keys = subsets(b"abcde").into_iter().map(|x| (x, true)).collect();
    let dawg = dawg(&keys).compress();
    keys.iter().for_each(|(k, _)| assert_eq!(dawg.get(k), vec![true]));
    assert_eq!(dawg.entries().len(), 32);
    assert_eq!(dawg.get(b"ac"), vec![true]);
    assert_eq!(dawg.get(b"ca"), vec![]);
    assert_eq!(dawg.get(b"abc"), vec![true]);
    assert_eq!(dawg.get(b"cab"), vec![]);
    assert_eq!(dawg.size(), 6);
  }

  #[test]
  fn compression_handles_varied_values() {
    let keys = subsets(b"abcde").into_iter().map(|x| (x.clone(), x.len() % 2)).collect();
    let dawg = dawg(&keys).compress();
    keys.iter().for_each(|(k, _)| assert_eq!(dawg.get(k), vec![k.len() % 2]));
    assert_eq!(dawg.entries().len(), 32);
    assert_eq!(dawg.get(b"ac"), vec![0]);
    assert_eq!(dawg.get(b"ca"), vec![]);
    assert_eq!(dawg.get(b"abc"), vec![1]);
    assert_eq!(dawg.get(b"cab"), vec![]);
    assert_eq!(dawg.size(), 10);
  }

  #[bench]
  fn insertion_benchmark(b: &mut Bencher) {
    let keys = subsets(b"abcdefghij").into_iter().map(|x| (x, true)).collect();
    b.iter(|| assert!(dawg(&keys).size() >= 1024));
  }

  #[bench]
  fn compression_benchmark(b: &mut Bencher) {
    let keys = subsets(b"abcdefghij").into_iter().map(|x| (x, true)).collect();
    let dawg = dawg(&keys);
    b.iter(|| assert_eq!(dawg.compress().size(), 11));
  }

  #[bench]
  fn expanded_lookup_benchmark(b: &mut Bencher) {
    let keys = subsets(b"abcdefghij").into_iter().map(|x| (x, true)).collect();
    let dawg = dawg(&keys);
    b.iter(|| assert_eq!(dawg.get(b"acegi"), vec![true]));
  }

  #[bench]
  fn compressed_lookup_benchmark(b: &mut Bencher) {
    let keys = subsets(b"abcdefghij").into_iter().map(|x| (x, true)).collect();
    let dawg = dawg(&keys).compress();
    b.iter(|| assert_eq!(dawg.get(b"acegi"), vec![true]));
  }
}
