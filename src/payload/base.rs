use super::super::lib::base::Result;
use std::rc::Rc;

pub type Args<T> = Vec<(usize, T)>;

pub trait Payload: 'static + Clone + Default + PartialEq {
  fn parse(&str) -> Result<Self>;
  fn stringify(&self) -> String;
  fn template(&str) -> Result<Rc<Template<Self>>>;
}

pub trait Template<T> {
  fn merge(&self, xs: &Args<T>) -> T;
  fn split(&self, x: &T) -> Vec<Args<T>>;
}
