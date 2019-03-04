use super::super::lib::base::Result;

pub type Args<T> = Vec<(usize, T)>;

pub trait Payload: 'static + Clone + Default {
  fn base_lex(&str) -> Self;
  fn base_unlex(&self) -> Option<&str>;
  fn is_default(&self) -> bool;
  fn parse(&str) -> Result<Self>;
  fn stringify(&self) -> String;
  fn template(&str) -> Result<Box<Template<Self>>>;
}

pub trait Template<T> {
  fn merge(&self, xs: &Args<T>) -> T;
  fn split(&self, x: &T) -> Vec<Args<T>>;
}

// Helpers used by types that implement the Payload trait.

pub fn append<T: Clone>(xs: &[Args<T>], ys: &[Args<T>], zs: &mut Vec<Args<T>>) {
  for x in xs {
    for y in ys {
      zs.push(x.iter().chain(y.iter()).map(|z| z.clone()).collect());
    }
  }
}

pub fn cross<T: Clone>(a: Vec<Args<T>>, b: Vec<Args<T>>) -> Vec<Args<T>> {
  let mut result = Vec::with_capacity(a.len() * b.len());
  append(&a, &b, &mut result);
  result
}

pub struct VariableTemplate(pub usize);

impl<T: Clone + Default> Template<T> for VariableTemplate {
  fn merge(&self, xs: &Args<T>) -> T {
    let mut x = xs.iter().filter_map(|(i, x)| if *i == self.0 { Some(x.clone()) } else { None });
    x.next().unwrap_or_default()
  }
  fn split(&self, x: &T) -> Vec<Args<T>> {
    vec![vec![(self.0, x.clone())]]
  }
}
