use super::super::lib::base::Result;
use super::base::{append, Args, Payload, Template};
use rustc_hash::{FxHashMap, FxHashSet};
use std::rc::Rc;

// A JSON type used for utterance semantics.

pub type Json = Option<Rc<Value>>;

#[derive(Debug, PartialEq)]
pub enum Value {
  Boolean(bool),
  Number(f32),
  String(String),
  Dict(Vec<(String, Json)>),
  List(Vec<Json>),
}

impl Payload for Json {
  fn parse(input: &str) -> Result<Self> {
    Ok(template(input)?.merge(&vec![]))
  }

  fn stringify(&self) -> String {
    stringify(self)
  }

  fn template(input: &str) -> Result<Rc<Template<Self>>> {
    template(input)
  }
}

// Helpers for implementing the Payload trait.

fn stringify(input: &Json) -> String {
  match input {
    Some(x) => match &**x {
      Value::Boolean(x) => x.to_string(),
      Value::Number(x) => x.to_string(),
      Value::String(x) => x.clone(),
      Value::Dict(x) => {
        let terms = x.iter().map(|(k, v)| format!("{}: {}", k, stringify(v)));
        format!("{{{}}}", terms.collect::<Vec<_>>().join(", "))
      }
      Value::List(x) => {
        let terms = x.iter().map(|y| stringify(y));
        format!("[{}]", terms.collect::<Vec<_>>().join(", "))
      }
    },
    None => "null".to_string(),
  }
}

fn template(input: &str) -> Result<Rc<Template<Json>>> {
  use super::super::lib::combine::*;

  type Node = Rc<Template<Json>>;

  pub fn wrap(x: impl Template<Json> + 'static) -> Node {
    Rc::new(x)
  }

  thread_local! {
    static PARSER: Parser<Node> = {
      let ws = regexp(r#"\s*"#, |_| ());
      let id = seq2((regexp("[a-zA-Z_]+", |x| x.to_string()), &ws), |x| x.0);
      let st = |x| seq2((string(x, |_| ()), &ws), |x| x.0);

      // Parser for various primitive types.
      let index = seq2((regexp("(0|[1-9][0-9]*)", |x| x.parse::<usize>().unwrap()), &ws), |x| x.0);
      let number = seq2((any(&[
        regexp(r#"-?(?:[0-9]|[1-9][0-9]+)?(?:\.[0-9]+)\b"#, |x| x.parse::<f32>().unwrap()),
        regexp(r#"-?(?:[0-9]|[1-9][0-9]+)\b"#, |x| x.parse::<f32>().unwrap()),
      ]), &ws), |x| x.0);
      let string = seq2((any(&[
        regexp(r#""[^"]*""#, |x| x[1..x.len()-1].to_string()),
        regexp(r#"'[^']*'"#, |x| x[1..x.len()-1].to_string()),
      ]), &ws), |x| x.0);

      // The root parser, a lazily-computed recursive parser.
      let (cell, root) = lazy();
      let result = seq2((&ws, &root), |x| x.1);
      let variable = seq2((st("$"), &index), |x| wrap(VariableTemplate(x.1)));
      let spread = seq2((st("...$"), index), |x| wrap(VariableTemplate(x.1)));

      // Helpers needed to parse a dict.
      let key = any(&[&id, &string]);
      let dict_literals = map(separate(seq3((key, st(":"), &root), |x| x), st(","), 1), |x| {
        Item::Literals(x.into_iter().map(|(k, _, v)| (k, v)).collect())
      });
      let dict_variable = map(&spread, |x| Item::Variable(x));
      let dict_items = separate(any(&[dict_literals, dict_variable]), st(","), 0);
      let dict = seq3((st("{"), dict_items, st("}")), |x| dict(x.1));

      // Helpers needed to parse a list.
      let list_item = any(&[map(&spread, |x| (x, true)), map(&root, |x| (x, false))]);
      let list_items = separate(list_item, st(","), 0);
      let list = seq3((st("["), list_items, st("]")), |x| list(x.1));

      // Helpers needed to parse primitives.
      let primitive = any(&[
        map(st("null"), |_| wrap(BaseTemplate(None))),
        map(st("true"), |_| wrap(BaseTemplate(Some(Rc::new(Value::Boolean(true)))))),
        map(st("false"), |_| wrap(BaseTemplate(Some(Rc::new(Value::Boolean(false)))))),
        map(number, |x| wrap(BaseTemplate(Some(Rc::new(Value::Number(x)))))),
        map(string, |x| wrap(BaseTemplate(Some(Rc::new(Value::String(x)))))),
      ]);

      cell.replace(any(&[dict, list, primitive, variable]));
      result
    }
  }

  PARSER.with(|x| x.parse(input))
}

// Implementations of specific JSON templates.

fn cross<T: Clone>(a: Vec<Args<T>>, b: Vec<Args<T>>) -> Vec<Args<T>> {
  let mut result = Vec::with_capacity(a.len() * b.len());
  append(&a, &b, &mut result);
  result
}

fn coerce_dict(json: &Json) -> &[(String, Json)] {
  let x = json.as_ref();
  x.map(|x| if let Value::Dict(y) = &**x { y.as_slice() } else { &[] }).unwrap_or_default()
}

fn coerce_list(json: &Json) -> &[Json] {
  let x = json.as_ref();
  x.map(|x| if let Value::List(y) = &**x { y.as_slice() } else { &[] }).unwrap_or_default()
}

fn dict_to_null(xs: Vec<(String, Json)>) -> Json {
  if xs.is_empty() {
    None
  } else {
    Some(Rc::new(Value::Dict(xs)))
  }
}

fn list_to_null(xs: Vec<Json>) -> Json {
  if xs.is_empty() {
    None
  } else {
    Some(Rc::new(Value::List(xs)))
  }
}

struct DictBaseTemplate(Vec<(String, Rc<Template<Json>>)>, FxHashSet<String>);

impl Template<Json> for DictBaseTemplate {
  fn merge(&self, xs: &Args<Json>) -> Json {
    let iter = self.0.iter().filter_map(|(k, v)| v.merge(xs).map(|x| (k.clone(), Some(x))));
    dict_to_null(iter.collect::<Vec<_>>())
  }

  fn split(&self, x: &Json) -> Vec<Args<Json>> {
    let xs = coerce_dict(x);
    if !xs.iter().all(|(k, _)| self.1.contains(k)) {
      return vec![];
    }
    let base = vec![vec![]];
    let mut dict = FxHashMap::default();
    xs.iter().for_each(|(k, v)| std::mem::drop(dict.insert(k, v)));
    self.0.iter().fold(base, |a, (k, v)| cross(a, v.split(dict.get(k).cloned().unwrap_or(&None))))
  }
}

struct DictPairTemplate(Rc<Template<Json>>, Rc<Template<Json>>);

impl Template<Json> for DictPairTemplate {
  fn merge(&self, xs: &Args<Json>) -> Json {
    let mut result = vec![];
    result.extend_from_slice(coerce_dict(&self.0.merge(xs)));
    result.extend_from_slice(coerce_dict(&self.1.merge(xs)));
    dict_to_null(result)
  }

  fn split(&self, x: &Json) -> Vec<Args<Json>> {
    let mut base = coerce_dict(x).iter().collect::<Vec<_>>();
    base.sort_by_key(|(k, _)| k);
    let mut result = vec![];
    for i in 0..(1 << base.len()) {
      let mut xs = (vec![], vec![]);
      for (j, (k, v)) in base.iter().enumerate() {
        if (1 << j) & i > 0 {
          xs.0.push((k.clone(), v.clone()));
        } else {
          xs.1.push((k.clone(), v.clone()));
        }
      }
      let x0 = self.0.split(&dict_to_null(xs.0));
      let x1 = self.1.split(&dict_to_null(xs.1));
      append(&x0, &x1, &mut result);
    }
    result
  }
}

struct DictWrapTemplate(Rc<Template<Json>>);

impl Template<Json> for DictWrapTemplate {
  fn merge(&self, xs: &Args<Json>) -> Json {
    self.0.merge(xs)
  }

  fn split(&self, x: &Json) -> Vec<Args<Json>> {
    if x.as_ref().map(|y| if let Value::Dict(_) = &**y { true } else { false }).unwrap_or(true) {
      self.0.split(x)
    } else {
      vec![]
    }
  }
}

struct ListBaseTemplate(Rc<Template<Json>>);

impl Template<Json> for ListBaseTemplate {
  fn merge(&self, xs: &Args<Json>) -> Json {
    self.0.merge(xs).map(|x| Rc::new(Value::List(vec![Some(x)])))
  }

  fn split(&self, x: &Json) -> Vec<Args<Json>> {
    let xs = coerce_list(x);
    match xs.len() {
      0 => self.0.split(&None),
      1 => self.0.split(&xs[0]),
      _ => vec![],
    }
  }
}

struct ListPairTemplate(Rc<Template<Json>>, Rc<Template<Json>>);

impl Template<Json> for ListPairTemplate {
  fn merge(&self, xs: &Args<Json>) -> Json {
    let mut result = vec![];
    result.extend_from_slice(coerce_list(&self.0.merge(xs)));
    result.extend_from_slice(coerce_list(&self.1.merge(xs)));
    list_to_null(result)
  }

  fn split(&self, x: &Json) -> Vec<Args<Json>> {
    let xs = coerce_list(x);
    let mut result = vec![];
    for i in 0..=xs.len() {
      let x0 = self.0.split(&list_to_null(xs[..i].to_owned()));
      let x1 = self.1.split(&list_to_null(xs[i..].to_owned()));
      append(&x0, &x1, &mut result);
    }
    result
  }
}

struct ListWrapTemplate(Rc<Template<Json>>);

impl Template<Json> for ListWrapTemplate {
  fn merge(&self, xs: &Args<Json>) -> Json {
    self.0.merge(xs)
  }

  fn split(&self, x: &Json) -> Vec<Args<Json>> {
    if x.as_ref().map(|y| if let Value::List(_) = &**y { true } else { false }).unwrap_or(true) {
      self.0.split(x)
    } else {
      vec![]
    }
  }
}

// Specific implementations of the Template interface.

enum Item {
  Literals(Vec<(String, Rc<Template<Json>>)>),
  Variable(Rc<Template<Json>>),
}

struct BaseTemplate(Json);

impl Template<Json> for BaseTemplate {
  fn merge(&self, _: &Args<Json>) -> Json {
    self.0.clone()
  }

  fn split(&self, x: &Json) -> Vec<Args<Json>> {
    if *x == self.0 {
      vec![vec![]]
    } else {
      vec![]
    }
  }
}

struct VariableTemplate(usize);

impl Template<Json> for VariableTemplate {
  fn merge(&self, xs: &Args<Json>) -> Json {
    xs.iter().filter_map(|(i, x)| if *i == self.0 { x.clone() } else { None }).next()
  }
  fn split(&self, x: &Json) -> Vec<Args<Json>> {
    vec![vec![(self.0, x.clone())]]
  }
}

fn dict(items: Vec<Item>) -> Rc<Template<Json>> {
  if items.is_empty() {
    return Rc::new(BaseTemplate(None));
  }
  let mut xs = items.into_iter().map(|x| match x {
    Item::Literals(dict) => {
      let keys = dict.iter().map(|(k, _)| k.clone()).collect::<FxHashSet<_>>();
      Rc::new(DictBaseTemplate(dict, keys))
    }
    Item::Variable(x) => x,
  });
  let base = xs.next().unwrap();
  Rc::new(DictWrapTemplate(xs.fold(base, |a, x| Rc::new(DictPairTemplate(a, x)))))
}

fn list(items: Vec<(Rc<Template<Json>>, bool)>) -> Rc<Template<Json>> {
  if items.is_empty() {
    return Rc::new(BaseTemplate(None));
  }
  let mut xs = items.into_iter().map(|x| match x {
    (x, false) => Rc::new(ListBaseTemplate(x)),
    (x, true) => x,
  });
  let base = xs.next().unwrap();
  Rc::new(ListWrapTemplate(xs.fold(base, |a, x| Rc::new(ListPairTemplate(a, x)))))
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  fn j(input: &str) -> Json {
    Json::parse(input).unwrap()
  }

  fn t(input: &str) -> Rc<Template<Json>> {
    Json::template(input).unwrap()
  }

  fn empty() -> Vec<Args<Json>> {
    vec![]
  }

  fn merge(template: &Template<Json>, args: Vec<Json>) -> Json {
    template.merge(&args.into_iter().enumerate().collect())
  }

  fn test_error<T: std::fmt::Debug>(result: Result<T>, prefix: &str) {
    let error = result.unwrap_err();
    if !error.starts_with(prefix) {
      let error = error.split('\n').nth(0).unwrap_or("");
      panic!("Error does not match prefix:\nexpected: {:?}\n  actual: {:?}", prefix, error);
    }
  }

  #[test]
  fn parsing_works() {
    assert_eq!(j("false"), Some(Rc::new(Value::Boolean(false))));
    assert_eq!(j("17.5"), Some(Rc::new(Value::Number(17.5))));
    assert_eq!(j("'1000'"), Some(Rc::new(Value::String("1000".to_string()))));
    assert_eq!(
      j("{num: 17, str: 'is', bool: false}"),
      Some(Rc::new(Value::Dict(vec![
        ("num".to_string(), Some(Rc::new(Value::Number(17.0)))),
        ("str".to_string(), Some(Rc::new(Value::String("is".to_string())))),
        ("bool".to_string(), Some(Rc::new(Value::Boolean(false)))),
      ])))
    );
    assert_eq!(
      j("[17, 'is', false]"),
      Some(Rc::new(Value::List(vec![
        Some(Rc::new(Value::Number(17.0))),
        Some(Rc::new(Value::String("is".to_string()))),
        Some(Rc::new(Value::Boolean(false))),
      ])))
    );
  }

  #[test]
  fn boolean_template_works() {
    let template = t("false");
    assert_eq!(merge(&*template, vec![]), j("false"));
    assert_eq!(template.split(&j("false")), vec![vec![]]);
    assert_eq!(template.split(&j("true")), empty());
    assert_eq!(template.split(&j("null")), empty());
  }

  #[test]
  fn number_template_works() {
    let template = t("17.5");
    assert_eq!(merge(&*template, vec![]), j("17.5"));
    assert_eq!(template.split(&j("17.5")), vec![vec![]]);
    assert_eq!(template.split(&j("17")), empty());
    assert_eq!(template.split(&j("null")), empty());
  }

  #[test]
  fn string_template_works() {
    let template = t("'1000'");
    assert_eq!(merge(&*template, vec![]), j("'1000'"));
    assert_eq!(template.split(&j("'1000'")), vec![vec![]]);
    assert_eq!(template.split(&j("1000")), empty());
    assert_eq!(template.split(&j("null")), empty());
  }

  #[test]
  fn dict_template_works() {
    let template = t("{num: 17, str: 'is', bool: false}");
    assert_eq!(merge(&*template, vec![]), j("{num: 17, str: 'is', bool: false}"));
    assert_eq!(template.split(&j("{num: 17, str: 'is', bool: false}")), vec![vec![]]);
    assert_eq!(template.split(&j("{bool: false, num: 17, str: 'is'}")), vec![vec![]]);
    assert_eq!(template.split(&j("{num: 18, str: 'is', bool: false}")), empty());
    assert_eq!(template.split(&j("null")), empty());
  }

  #[test]
  fn list_template_works() {
    let template = t("[17, 'is', false]");
    assert_eq!(merge(&*template, vec![]), j("[17, 'is', false]"));
    assert_eq!(template.split(&j("[17, 'is', false]")), vec![vec![]]);
    assert_eq!(template.split(&j("[false, 17, 'is']")), empty());
    assert_eq!(template.split(&j("[18, 'is', false]")), empty());
    assert_eq!(template.split(&j("null")), empty());
  }

  #[test]
  fn variable_template_works() {
    let template = t("$2");
    assert_eq!(merge(&*template, vec![]), j("null"));
    assert_eq!(merge(&*template, vec![j("null"), j("null"), j("17")]), j("17"));
    assert_eq!(template.split(&j("17")), vec![vec![(2, j("17"))]]);
    assert_eq!(template.split(&j("null")), vec![vec![(2, j("null"))]]);
  }

  #[test]
  fn dict_with_variables_works() {
    let t = t("{num: $0, bool: $2}");
    assert_eq!(merge(&*t, vec![j("17"), j("'is'"), j("false")]), j("{num: 17, bool: false}"));
    assert_eq!(merge(&*t, vec![j("17"), j("'is'"), j("null")]), j("{num: 17}"));
    assert_eq!(merge(&*t, vec![j("null"), j("'is'"), j("null")]), j("null"));
    assert_eq!(t.split(&j("{num: 17, bool: false, key: 'value'}")), empty());
    assert_eq!(t.split(&j("{num: 17, bool: false}")), vec![vec![(0, j("17")), (2, j("false"))]]);
    assert_eq!(t.split(&j("{num: 17}")), vec![vec![(0, j("17")), (2, j("null"))]]);
    assert_eq!(t.split(&j("null")), vec![vec![(0, j("null")), (2, j("null"))]]);
    assert_eq!(t.split(&j("false")), empty());
  }

  #[test]
  fn dict_with_spreads_works() {
    let t = t("{num: $0, ...$1, bool: $2}");
    assert_eq!(
      merge(&*t, vec![j("17"), j("{str: 'is'}"), j("false")]),
      j("{num: 17, str: 'is', bool: false}")
    );
    assert_eq!(merge(&*t, vec![j("17"), j("null"), j("false")]), j("{num: 17, bool: false}"));
    assert_eq!(merge(&*t, vec![j("null"), j("null"), j("null")]), j("null"));
    assert_eq!(
      t.split(&j("{num: 17, bool: false}")),
      vec![
        vec![(0, j("null")), (1, j("{num: 17}")), (2, j("false"))],
        vec![(0, j("17")), (1, j("null")), (2, j("false"))],
        vec![(0, j("null")), (1, j("{bool: false, num: 17}")), (2, j("null"))],
        vec![(0, j("17")), (1, j("{bool: false}")), (2, j("null"))],
      ]
    );
    assert_eq!(
      t.split(&j("{num: 17}")),
      vec![
        vec![(0, j("null")), (1, j("{num: 17}")), (2, j("null"))],
        vec![(0, j("17")), (1, j("null")), (2, j("null"))],
      ]
    );
    assert_eq!(t.split(&j("null")), vec![vec![(0, j("null")), (1, j("null")), (2, j("null"))],]);
    assert_eq!(t.split(&j("false")), empty());
  }

  #[test]
  fn list_with_variables_works() {
    let t = t("[$0, $1]");
    assert_eq!(merge(&*t, vec![j("3"), j("5")]), j("[3, 5]"));
    assert_eq!(merge(&*t, vec![j("3"), j("null")]), j("[3]"));
    assert_eq!(merge(&*t, vec![j("null"), j("null")]), j("null"));
    assert_eq!(t.split(&j("[3, 5, 7]")), empty());
    assert_eq!(t.split(&j("[3, 5]")), vec![vec![(0, j("3")), (1, j("5"))]]);
    assert_eq!(
      t.split(&j("[3]")),
      vec![vec![(0, j("null")), (1, j("3"))], vec![(0, j("3")), (1, j("null"))],]
    );
    assert_eq!(t.split(&j("null")), vec![vec![(0, j("null")), (1, j("null"))]]);
    assert_eq!(t.split(&j("false")), empty());
  }

  #[test]
  fn list_with_spreads_works() {
    let t = t("[$0, ...$1, ...$2]");
    assert_eq!(merge(&*t, vec![j("3"), j("[5, 7]"), j("null")]), j("[3, 5, 7]"));
    assert_eq!(merge(&*t, vec![j("3"), j("null"), j("null")]), j("[3]"));
    assert_eq!(merge(&*t, vec![j("null"), j("null"), j("null")]), j("null"));
    assert_eq!(
      t.split(&j("[3, 5, 7]")),
      vec![
        vec![(0, j("null")), (1, j("null")), (2, j("[3, 5, 7]"))],
        vec![(0, j("null")), (1, j("[3]")), (2, j("[5, 7]"))],
        vec![(0, j("3")), (1, j("null")), (2, j("[5, 7]"))],
        vec![(0, j("null")), (1, j("[3, 5]")), (2, j("[7]"))],
        vec![(0, j("3")), (1, j("[5]")), (2, j("[7]"))],
        vec![(0, j("null")), (1, j("[3, 5, 7]")), (2, j("null"))],
        vec![(0, j("3")), (1, j("[5, 7]")), (2, j("null"))],
      ]
    );
    assert_eq!(
      t.split(&j("[3, 5]")),
      vec![
        vec![(0, j("null")), (1, j("null")), (2, j("[3, 5]"))],
        vec![(0, j("null")), (1, j("[3]")), (2, j("[5]"))],
        vec![(0, j("3")), (1, j("null")), (2, j("[5]"))],
        vec![(0, j("null")), (1, j("[3, 5]")), (2, j("null"))],
        vec![(0, j("3")), (1, j("[5]")), (2, j("null"))],
      ]
    );
    assert_eq!(
      t.split(&j("[3]")),
      vec![
        vec![(0, j("null")), (1, j("null")), (2, j("[3]"))],
        vec![(0, j("null")), (1, j("[3]")), (2, j("null"))],
        vec![(0, j("3")), (1, j("null")), (2, j("null"))],
      ]
    );
    assert_eq!(t.split(&j("null")), vec![vec![(0, j("null")), (1, j("null")), (2, j("null"))],]);
    assert_eq!(t.split(&j("false")), empty());
  }

  #[test]
  fn parse_fails_on_unquoted_string_literal() {
    test_error(Json::parse("failed"), "At line 1, column 1");
  }

  #[test]
  fn parse_fails_on_malformatted_dict() {
    test_error(Json::parse("{num; 42}"), "At line 1, column 5");
  }

  #[test]
  fn parse_fails_on_malformatted_list() {
    test_error(Json::parse("[3 5]"), "At line 1, column 4");
  }

  #[test]
  fn parse_handles_whitespace() {
    let t = t(" { x : [ true , 2 , '3' , ...$0 , $1 ] , 'y' : $2 } ");
    assert_eq!(
      merge(&*t, vec![j("[4, 5]"), j("6"), j("7")]),
      j("{x: [true, 2, '3', 4, 5, 6], y: 7}")
    );
  }

  #[bench]
  fn parse_benchmark(b: &mut Bencher) {
    b.iter(|| Json::parse("{num: 17, str: 'is', bool: false, list: [3, 5, 7]}").unwrap());
  }

  #[bench]
  fn stringify_benchmark(b: &mut Bencher) {
    let x = Json::parse("{num: 17, str: 'is', bool: false, list: [3, 5, 7]}").unwrap();
    b.iter(|| x.stringify());
  }

  #[bench]
  fn template_benchmark(b: &mut Bencher) {
    b.iter(|| Json::template("{num: 17, str: 'is', bool: false, list: [3, 5, 7]}").unwrap());
  }

  #[bench]
  fn template_merge_benchmark(b: &mut Bencher) {
    let template = Json::template("{num: 17, str: 'is', bool: false, list: [3, 5, 7]}").unwrap();
    b.iter(|| template.merge(&vec![]).unwrap());
  }

  #[bench]
  fn template_dict_split_easy_benchmark(b: &mut Bencher) {
    let json = Json::parse("{x: 3, y: 5, z: 7}").unwrap();
    let template = Json::template("{x: $0, y: $1, z: $2}").unwrap();
    assert_eq!(template.split(&json).len(), 1);
    b.iter(|| template.split(&json));
  }

  #[bench]
  fn template_dict_split_hard_benchmark(b: &mut Bencher) {
    let json = Json::parse("{x: 3, y: 5, z: 7}").unwrap();
    let template = Json::template("{x: $0, y: $1, ...$2}").unwrap();
    assert_eq!(template.split(&json).len(), 4);
    b.iter(|| template.split(&json));
  }

  #[bench]
  fn template_list_split_easy_benchmark(b: &mut Bencher) {
    let json = Json::parse("[3, 4, 5]").unwrap();
    let template = Json::template("[$0, ...$1]").unwrap();
    assert_eq!(template.split(&json).len(), 2);
    b.iter(|| template.split(&json));
  }

  #[bench]
  fn template_list_split_hard_benchmark(b: &mut Bencher) {
    let json = Json::parse("[3, 4, 5]").unwrap();
    let template = Json::template("[$0, ...$1, ...$2]").unwrap();
    assert_eq!(template.split(&json).len(), 7);
    b.iter(|| template.split(&json));
  }
}
