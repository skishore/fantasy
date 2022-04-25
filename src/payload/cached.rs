use super::super::lib::base::Result;
use super::base::{Payload, Template};
use std::cell::UnsafeCell;
use std::fmt::Display;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

// A helper trait used to implement the Payload trait. Implement Base for T, and then
// use Cached<T> as your Payload type. You can also use Cached<T> as a field of T and
// get a quick way to cache and clone partial computations.
//
// This trait needs:
//  - A way to project strings into the payload type: base_lex / base_unlex
//  - A canonical implementation of Display: x == y iff x.to_string() == y.to_string()
//  - An optional static default callback, used as an optimization: default_static
//
// The PartialEq method on Base does *not* need to canonicalize. The Display result will
// be used for all equality checks and hashing on the Cached<T> type for a Base type T.

pub trait Base: 'static + Default + Display + PartialEq {
  fn base_lex(_: &str) -> Self;
  fn base_unlex(&self) -> Option<&str>;
  fn default_static() -> Cached<Self>;
  fn template(_: &str) -> Result<Box<dyn Template<Cached<Self>>>>;
}

#[derive(Debug)]
pub struct Cached<T>(Rc<(T, UnsafeCell<String>)>);

impl<T: Base> Cached<T> {
  pub fn new(base: T) -> Self {
    Self(Rc::new((base, UnsafeCell::default())))
  }

  pub fn expr(&self) -> &T {
    &(self.0).0
  }

  pub fn repr(&self) -> &str {
    let x = unsafe { &mut *(self.0).1.get() };
    if x.is_empty() {
      *x = self.expr().to_string();
    }
    x
  }
}

impl<T: Base> Clone for Cached<T> {
  fn clone(&self) -> Self {
    Self(Rc::clone(&self.0))
  }
}

impl<T: Base> Default for Cached<T> {
  fn default() -> Self {
    T::default_static()
  }
}

impl<T: Base> Eq for Cached<T> {}

impl<T: Base> Hash for Cached<T> {
  fn hash<H: Hasher>(&self, h: &mut H) {
    self.repr().hash(h);
  }
}

impl<T: Base> PartialEq for Cached<T> {
  fn eq(&self, other: &Self) -> bool {
    self.repr() == other.repr()
  }
}

impl<T: Base> Payload for Cached<T> {
  fn base_lex(x: &str) -> Self {
    Self::new(T::base_lex(x))
  }

  fn base_unlex(&self) -> Option<&str> {
    self.expr().base_unlex()
  }

  fn empty(&self) -> bool {
    *self.expr() == T::default()
  }

  fn parse(x: &str) -> Result<Self> {
    let default = Self::default();
    if x == default.repr() {
      return Ok(default);
    }
    let y = Self::template(x)?.merge(&vec![]);
    return if y.empty() { Err(format!("Empty payload: {}", x))? } else { Ok(y) };
  }

  fn template(x: &str) -> Result<Box<dyn Template<Self>>> {
    T::template(x)
  }
}
