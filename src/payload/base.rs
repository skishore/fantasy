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

pub fn append<T: Clone>(xs: &[Args<T>], ys: &[Args<T>], zs: &mut Vec<Args<T>>) {
  for x in xs {
    for y in ys {
      zs.push(x.iter().chain(y.iter()).map(|z| z.clone()).collect());
    }
  }
}
