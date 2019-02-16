// An Arena lets us store objects of type T in a pre-allocated block of memory,
// which can be much faster than allocating individual objects one at a time.
// If T is Copy, then we can clean up the Arena just be de-allocating blocks.
// References to arena-allocated objects remain valid for the Arena's lifetime.

pub struct Arena<T> {
  current: Vec<T>,
  rest: Vec<Vec<T>>,
}

impl<T> Arena<T> {
  pub fn new() -> Self {
    Self { current: vec![], rest: vec![] }
  }

  pub fn with_capacity(n: usize) -> Self {
    Self { current: Vec::with_capacity(n), rest: vec![] }
  }

  pub fn alloc(&mut self, value: T) -> &mut T {
    let capacity = self.current.capacity();
    if self.current.len() == capacity {
      let mut next = Vec::with_capacity(std::cmp::max(2 * capacity, 1));
      std::mem::swap(&mut next, &mut self.current);
      self.rest.push(next);
    }
    let len = self.current.len();
    assert!(len < self.current.capacity());
    self.current.push(value);
    &mut self.current[len]
  }
}
