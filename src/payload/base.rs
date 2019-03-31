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
  reversed: Vec<Option<usize>>,
  slots: Vec<Option<(usize, bool)>>,
  template: Box<Template<T>>,
}

impl<T: Payload> SlotTemplate<T> {
  pub fn new(n: usize, slots: Vec<Option<(usize, bool)>>, template: Box<Template<T>>) -> Self {
    let mut reversed = vec![None; n];
    slots.iter().enumerate().for_each(|(i, x)| x.iter().for_each(|y| reversed[y.0] = Some(i)));
    Self { reversed, slots, template }
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
      for (k, v) in xs.into_iter() {
        if let Some(slot) = self.slots[k] {
          if v.is_default() && !slot.1 {
            return None;
          }
          result.push((slot.0, v));
        } else if !v.is_default() {
          return None;
        }
      }
      Some(result)
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

#[cfg(test)]
mod tests {
  use super::super::json::Json;
  use super::*;

  fn j(input: &str) -> Json {
    Json::parse(input).unwrap()
  }

  fn t(input: &str) -> Box<Template<Json>> {
    Json::template(input).unwrap()
  }

  fn empty() -> Vec<Args<Json>> {
    vec![]
  }

  fn merge(template: &Template<Json>, args: Vec<Json>) -> Json {
    template.merge(&args.into_iter().enumerate().collect())
  }

  #[test]
  fn slot_template_works() {
    let slots = vec![Some((3, false)), Some((4, false)), Some((5, true))];
    let t = SlotTemplate::new(6, slots, t("[$0, ...$1, ...$2]"));
    assert_eq!(merge(&t, vec![j("3"), j("[5, 7]"), j("null")]), j("null"));
    assert_eq!(
      merge(&t, vec![j("null"), j("null"), j("null"), j("3"), j("[5, 7]")]),
      j("[3, 5, 7]")
    );
    assert_eq!(
      merge(&t, vec![j("null"), j("null"), j("null"), j("3"), j("[5, 7]"), j("null")]),
      j("[3, 5, 7]")
    );
    assert_eq!(
      merge(&t, vec![j("null"), j("null"), j("null"), j("3"), j("null"), j("[5, 7]")]),
      j("[3, 5, 7]")
    );
    assert_eq!(
      t.split(&j("[3, 5, 7]")),
      [
        [(3, j("3")), (4, j("[5]")), (5, j("[7]"))],
        [(3, j("3")), (4, j("[5, 7]")), (5, j("null"))],
      ]
    );
    assert_eq!(t.split(&j("[3, 5]")), [[(3, j("3")), (4, j("[5]")), (5, j("null"))]]);
    assert_eq!(t.split(&j("[3]")), empty());
    assert_eq!(t.split(&j("null")), empty());
  }

  #[test]
  fn slot_template_handles_missing_slots() {
    let slots = vec![Some((2, false)), None, Some((4, true))];
    let t = SlotTemplate::new(6, slots, t("[$0, ...$1, ...$2]"));
    assert_eq!(merge(&t, vec![j("3"), j("[5, 7]"), j("null")]), j("null"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("[5]")]), j("[3]"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("[5]"), j("null")]), j("[3]"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("null"), j("[5]")]), j("[3, 5]"));
    assert_eq!(t.split(&j("[3, 5]")), [[(2, j("3")), (4, j("[5]"))]]);
    assert_eq!(t.split(&j("[3]")), [[(2, j("3")), (4, j("null"))]]);
    assert_eq!(t.split(&j("null")), empty());
  }

  #[test]
  fn slot_template_handles_all_optional_slots() {
    let slots = vec![Some((2, true)), None, Some((4, true))];
    let t = SlotTemplate::new(6, slots, t("[$0, ...$1, ...$2]"));
    assert_eq!(merge(&t, vec![j("3"), j("[5, 7]"), j("null")]), j("null"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("[5]")]), j("[3]"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("[5]"), j("null")]), j("[3]"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("null"), j("[5]")]), j("[3, 5]"));
    assert_eq!(
      t.split(&j("[3, 5]")),
      [[(2, j("null")), (4, j("[3, 5]"))], [(2, j("3")), (4, j("[5]"))]]
    );
    assert_eq!(
      t.split(&j("[3]")),
      [[(2, j("null")), (4, j("[3]"))], [(2, j("3")), (4, j("null"))]]
    );
    assert_eq!(t.split(&j("null")), [[(2, j("null")), (4, j("null"))]]);
  }

  #[test]
  fn slot_template_handles_all_required_slots() {
    let slots = vec![Some((2, false)), None, Some((4, false))];
    let t = SlotTemplate::new(6, slots, t("[$0, ...$1, ...$2]"));
    assert_eq!(merge(&t, vec![j("3"), j("[5, 7]"), j("null")]), j("null"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("[5]")]), j("[3]"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("[5]"), j("null")]), j("[3]"));
    assert_eq!(merge(&t, vec![j("null"), j("null"), j("3"), j("null"), j("[5]")]), j("[3, 5]"));
    assert_eq!(t.split(&j("[3, 5]")), [[(2, j("3")), (4, j("[5]"))]]);
    assert_eq!(t.split(&j("[3]")), empty());
    assert_eq!(t.split(&j("null")), empty());
  }
}
