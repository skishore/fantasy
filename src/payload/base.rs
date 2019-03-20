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

pub struct DefaultTemplate {}

impl<T: Payload> Template<T> for DefaultTemplate {
  fn merge(&self, _: &Args<T>) -> T {
    T::default()
  }
  fn split(&self, x: &T) -> Vec<Args<T>> {
    return if x.is_default() { vec![vec![]] } else { vec![] };
  }
}

pub struct SlotTemplate<T: Payload> {
  required: usize,
  reversed: Vec<Option<usize>>,
  slots: Vec<Option<(usize, bool)>>,
  template: Box<Template<T>>,
}

impl<T: Payload> SlotTemplate<T> {
  pub fn new(n: usize, slots: Vec<Option<(usize, bool)>>, template: Box<Template<T>>) -> Self {
    let required = slots.iter().filter(|x| x.map_or(false, |y| !y.1)).count();
    let mut reversed = vec![None; n];
    slots.iter().enumerate().for_each(|(i, x)| x.iter().for_each(|y| reversed[y.0] = Some(i)));
    Self { required, reversed, slots, template }
  }
}

impl<T: Payload> Template<T> for SlotTemplate<T> {
  fn merge(&self, xs: &Args<T>) -> T {
    let mut args: Args<T> = vec![];
    xs.iter().for_each(|(k, v)| self.reversed[*k].iter().for_each(|i| args.push((*i, v.clone()))));
    self.template.merge(&args)
  }
  fn split(&self, x: &T) -> Vec<Args<T>> {
    let result = self.template.split(x).into_iter().filter_map(|xs| {
      let mut result: Args<T> = vec![];
      let mut missing = self.required;
      for (k, v) in xs.into_iter() {
        if let Some(slot) = self.slots[k] {
          result.push((slot.0, v));
          missing -= if slot.1 { 0 } else { 1 };
        } else if !v.is_default() {
          return None;
        }
      }
      return if missing > 0 { None } else { Some(result) };
    });
    result.collect()
  }
}

pub struct UnitTemplate {}

impl<T: Payload> Template<T> for UnitTemplate {
  fn merge(&self, xs: &Args<T>) -> T {
    xs.iter().filter(|(i, _)| *i == 0).next().map(|(_, x)| x.clone()).unwrap_or_default()
  }
  fn split(&self, x: &T) -> Vec<Args<T>> {
    vec![vec![(0, x.clone())]]
  }
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
