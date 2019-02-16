use std::rc::Rc;

pub type Args<T> = Vec<(usize, T)>;

pub trait Template<T> {
  fn merge(&self, xs: &Args<T>) -> T;
  fn split(&self, x: &T) -> Vec<Args<T>>;
}

// A lambda DCS type used for utterance semantics.

type OptionLambda = Option<Rc<Lambda>>;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Binary {
  Conjunction,
  Disjunction,
  Join,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Unary {
  Not,
  Reverse,
}

#[derive(Debug, PartialEq)]
pub enum Lambda {
  Binary(Binary, Vec<Rc<Lambda>>),
  Custom(String, Vec<Rc<Lambda>>),
  Terminal(String),
  Unary(Unary, Rc<Lambda>),
}

impl Lambda {
  pub fn parse(input: &str) -> Result<Rc<Lambda>, String> {
    template(input)?.merge(&vec![]).ok_or("Empty lambda expression!".to_string())
  }

  pub fn stringify(&self) -> String {
    stringify(self, std::u32::MAX)
  }

  pub fn template(input: &str) -> Result<Rc<Template<OptionLambda>>, String> {
    template(input)
  }
}

// Helpers for representing lambda DCS expressions.

struct Operator {
  commutes: bool,
  precedence: u32,
  text: String,
}

impl Binary {
  fn data(&self) -> Operator {
    match self {
      Binary::Conjunction => Operator { commutes: true, precedence: 2, text: " & ".to_string() },
      Binary::Disjunction => Operator { commutes: true, precedence: 2, text: " | ".to_string() },
      Binary::Join => Operator { commutes: false, precedence: 0, text: ".".to_string() },
    }
  }
}

impl Unary {
  fn data(&self) -> Operator {
    match self {
      Unary::Not => Operator { commutes: false, precedence: 1, text: "~".to_string() },
      Unary::Reverse => Operator { commutes: false, precedence: 3, text: "R".to_string() },
    }
  }
}

fn stringify(lambda: &Lambda, context: u32) -> String {
  match lambda {
    Lambda::Binary(op, children) => {
      let Operator { commutes, precedence, text } = op.data();
      let mut base: Vec<_> = children.into_iter().map(|x| stringify(x, precedence)).collect();
      if commutes {
        base.sort();
      }
      if precedence < context {
        base.join(&text)
      } else {
        format!("({})", base.join(&text))
      }
    }
    Lambda::Custom(name, children) => {
      let base: Vec<_> = children.into_iter().map(|x| x.stringify()).collect();
      format!("{}({})", name, base.join(", "))
    }
    Lambda::Terminal(name) => name.to_string(),
    Lambda::Unary(op, child) => {
      let Operator { precedence, text, .. } = op.data();
      let base = stringify(child, precedence);
      if let Unary::Reverse = op {
        format!("{}[{}]", text, base)
      } else if precedence < context {
        format!("{}{}", text, base)
      } else {
        format!("({}{})", text, base)
      }
    }
  }
}

fn template(input: &str) -> Result<Rc<Template<OptionLambda>>, String> {
  use super::combine::*;
  use std::thread_local;

  type Node = Rc<Template<OptionLambda>>;

  pub fn wrap(x: impl Template<OptionLambda> + 'static) -> Node {
    Rc::new(x)
  }

  thread_local! {
    static PARSER: Parser<Node> = {
      let ws = regexp(r#"\s*"#, |_| ());
      let st = |x| seq2((string(x, |_| ()), &ws), |x| x.0);
      let id = seq2((regexp("[a-zA-Z0-9_]+", |x| x.to_string()), &ws), |x| x.0);
      let number = seq2((regexp("(0|[1-9][0-9]*)", |x| x.parse::<usize>().unwrap()), &ws), |x| x.0);

      let base = |x: Parser<Node>| {
        any(&[
          seq4((st("R"), st("["), &x, st("]")), |x| wrap(UnaryTemplate(Unary::Reverse, x.2))),
          seq2(
            (&id, opt(seq3((st("("), separate(&x, st(","), 0), st(")")), |x| x.1))),
            |x| match x.1 {
              Some(xs) => wrap(CustomTemplate(x.0, xs)),
              None => wrap(TerminalTemplate(x.0.clone(), Some(Rc::new(Lambda::Terminal(x.0))))),
            },
          ),
          seq3((st("("), &x, st(")")), |x| x.1),
          seq2((st("$"), &number), |x| wrap(VariableTemplate(x.1))),
        ])
      };

      let binaries = |ops: Vec<(&'static str, Binary)>| {
        move |x: Parser<Node>| {
          let mut options = Vec::with_capacity(ops.len() + 1);
          for (name, op) in ops.iter() {
            let op = op.clone();
            options.push(map(repeat(seq2((st(name), &x), |x| x.1), 1), move |x| Some((op, x))));
          }
          options.push(succeed(|| None));
          seq2((x, any(&options)), |x| match x.1 {
            Some((op, mut xs)) => xs.drain(..).fold(x.0, |acc, x| wrap(BinaryTemplate(op, acc, x))),
            None => x.0,
          })
        }
      };

      let unary = |name: &'static str, op: Unary| {
        move |x: Parser<Node>| {
          any(&[&x, &seq2((st(name), &x), move |x| wrap(UnaryTemplate(op, x.1)))])
        }
      };

      let (cell, root) = lazy();
      let result = seq2((&ws, &root), |x| x.1);
      let precedence: Vec<Box<Fn(Parser<Node>) -> Parser<Node>>> = vec![
        Box::new(base),
        Box::new(binaries(vec![(".", Binary::Join)])),
        Box::new(unary("~", Unary::Not)),
        Box::new(binaries(vec![("&", Binary::Conjunction), ("|", Binary::Disjunction)])),
      ];
      cell.replace(precedence.iter().fold(root, |x, f| f(x)));
      result
    };
  }

  PARSER.with(|x| x.parse(input))
}

// Templates that operate on lambda DCS expressions.

struct BinaryTemplate(Binary, Rc<Template<OptionLambda>>, Rc<Template<OptionLambda>>);

impl Template<OptionLambda> for BinaryTemplate {
  fn merge(&self, xs: &Args<OptionLambda>) -> OptionLambda {
    let mut x1 = expand(self.0, self.1.merge(xs));
    let mut x2 = expand(self.0, self.2.merge(xs));
    if self.0.data().commutes || (!x1.is_empty() && !x2.is_empty()) {
      x1.append(&mut x2);
      collapse(self.0, x1)
    } else {
      None
    }
  }
  fn split(&self, x: &OptionLambda) -> Vec<Args<OptionLambda>> {
    let base = expand(self.0, x.clone());
    let commutes = self.0.data().commutes;
    if !commutes && base.is_empty() {
      let mut x1 = self.1.split(&None);
      let mut x2 = self.2.split(&None);
      return x1.drain(..).chain(x2.drain(..)).collect();
    }
    let bits: Vec<_> = if commutes {
      (0..(1 << base.len())).collect()
    } else {
      (0..(base.len() - 1)).map(|i| 1 << (i + 1) - 1).collect()
    };
    let mut result = vec![];
    for i in bits {
      let mut xs = (vec![], vec![]);
      for (j, x) in base.iter().enumerate() {
        if (1 << j) & i > 0 {
          xs.0.push(x.clone());
        } else {
          xs.1.push(x.clone());
        }
      }
      let x1 = self.1.split(&collapse(self.0, xs.0));
      let x2 = self.2.split(&collapse(self.0, xs.1));
      append(&x1, &x2, &mut result);
    }
    result
  }
}

struct CustomTemplate(String, Vec<Rc<Template<OptionLambda>>>);

impl Template<OptionLambda> for CustomTemplate {
  fn merge(&self, xs: &Args<OptionLambda>) -> OptionLambda {
    let xs: Vec<_> = self.1.iter().filter_map(|x| x.merge(xs)).collect();
    if xs.len() < self.1.len() {
      None
    } else {
      Some(Rc::new(Lambda::Custom(self.0.clone(), xs)))
    }
  }
  fn split(&self, x: &OptionLambda) -> Vec<Args<OptionLambda>> {
    match x {
      Some(x) => {
        if let Lambda::Custom(ref y, ref ys) = **x {
          if *y == self.0 && ys.len() == self.1.len() {
            return self.1.iter().enumerate().fold(vec![vec![]], |acc, (i, x)| {
              let mut result = vec![];
              append(&acc, &x.split(&Some(ys[i].clone())), &mut result);
              result
            });
          }
        }
        vec![]
      }
      None => {
        let mut result = Vec::with_capacity(self.1.len());
        self.1.iter().for_each(|x| result.append(&mut x.split(&None)));
        result
      }
    }
  }
}

struct TerminalTemplate(String, OptionLambda);

impl Template<OptionLambda> for TerminalTemplate {
  fn merge(&self, _: &Args<OptionLambda>) -> OptionLambda {
    self.1.clone()
  }
  fn split(&self, x: &OptionLambda) -> Vec<Args<OptionLambda>> {
    let matched = x.as_ref().map(|y| match **y {
      Lambda::Terminal(ref z) => *z == self.0,
      _ => false,
    });
    if matched.unwrap_or(false) {
      vec![vec![]]
    } else {
      vec![]
    }
  }
}

struct UnaryTemplate(Unary, Rc<Template<OptionLambda>>);

impl Template<OptionLambda> for UnaryTemplate {
  fn merge(&self, xs: &Args<OptionLambda>) -> OptionLambda {
    involute(self.0, self.1.merge(xs))
  }
  fn split(&self, x: &OptionLambda) -> Vec<Args<OptionLambda>> {
    self.1.split(&involute(self.0, x.clone()))
  }
}

struct VariableTemplate(usize);

impl Template<OptionLambda> for VariableTemplate {
  fn merge(&self, xs: &Args<OptionLambda>) -> OptionLambda {
    xs.iter().filter_map(|(i, x)| if *i == self.0 { x.clone() } else { None }).next()
  }
  fn split(&self, x: &OptionLambda) -> Vec<Args<OptionLambda>> {
    vec![vec![(self.0, x.clone())]]
  }
}

// Internal helpers for the templates above.

fn append<T: Clone>(xs: &[Args<T>], ys: &[Args<T>], zs: &mut Vec<Args<T>>) {
  for x in xs {
    for y in ys {
      zs.push(x.iter().chain(y.iter()).map(|z| z.clone()).collect());
    }
  }
}

fn collapse(op: Binary, mut x: Vec<Rc<Lambda>>) -> OptionLambda {
  match x.len() {
    0 | 1 => x.pop(),
    _ => Some(Rc::new(Lambda::Binary(op, x))),
  }
}

fn expand(op: Binary, x: OptionLambda) -> Vec<Rc<Lambda>> {
  match x {
    Some(x) => {
      if let Lambda::Binary(y, ref ys) = *x {
        if y == op {
          return ys.to_vec();
        }
      }
      vec![x]
    }
    None => vec![],
  }
}

fn involute(op: Unary, x: OptionLambda) -> OptionLambda {
  x.map(|x| {
    if let Lambda::Unary(y, ref ys) = *x {
      if y == op {
        return ys.clone();
      }
    }
    Rc::new(Lambda::Unary(op, x))
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  fn l(input: &str) -> OptionLambda {
    Some(Lambda::parse(input).unwrap())
  }

  fn t(input: &str) -> Rc<Template<OptionLambda>> {
    Lambda::template(input).unwrap()
  }

  fn merge(template: &Template<OptionLambda>, args: Vec<OptionLambda>) -> OptionLambda {
    template.merge(&args.into_iter().enumerate().collect())
  }

  #[test]
  fn merging_joins_works() {
    let template = t("color.$0");
    assert_eq!(merge(&*template, vec![l("red")]), l("color.red"));
    assert_eq!(merge(&*template, vec![None]), None);
  }

  #[test]
  fn merging_binary_operators_works() {
    let template = t("$0 & country.$1");
    assert_eq!(merge(&*template, vec![l("I"), l("US")]), l("I & country.US"));
    assert_eq!(merge(&*template, vec![l("I"), None]), l("I"));
    assert_eq!(merge(&*template, vec![None, l("US")]), l("country.US"));
    assert_eq!(merge(&*template, vec![None, None]), None);
  }

  #[test]
  fn merging_unary_operators_works() {
    let template = t("R[$0].I & ~$1");
    assert_eq!(merge(&*template, vec![l("name"), l("X")]), l("R[name].I & ~X"));
    assert_eq!(merge(&*template, vec![l("R[name]"), l("X")]), l("name.I & ~X"));
    assert_eq!(merge(&*template, vec![l("name"), l("~X")]), l("R[name].I & X"));
    assert_eq!(merge(&*template, vec![l("R[name]"), l("~X")]), l("name.I & X"));
    assert_eq!(merge(&*template, vec![l("name"), None]), l("R[name].I"));
    assert_eq!(merge(&*template, vec![None, l("~X")]), l("X"));
    assert_eq!(merge(&*template, vec![None, None]), None);
  }

  #[test]
  fn merging_custom_functions_works() {
    let template = t("Tell($0, name.$1)");
    assert_eq!(merge(&*template, vec![l("I"), l("X")]), l("Tell(I, name.X)"));
    assert_eq!(merge(&*template, vec![l("I"), None]), None);
    assert_eq!(merge(&*template, vec![None, l("X")]), None);
    assert_eq!(merge(&*template, vec![None, None]), None);
  }

  #[test]
  fn splitting_joins_works() {
    let template = t("color.$0");
    assert_eq!(template.split(&l("color.red")), vec![vec![(0, l("red"))]]);
    assert_eq!(template.split(&None), vec![vec![(0, None)]]);
  }

  #[test]
  fn splitting_binary_operators_works() {
    let template = t("$0 & country.$1");
    assert_eq!(
      template.split(&l("I & country.US")),
      vec![vec![(0, l("I")), (1, l("US"))], vec![(0, l("I & country.US")), (1, None)],]
    );
    assert_eq!(
      template.split(&l("country.US & I")),
      [vec![(0, l("I")), (1, l("US"))], vec![(0, l("country.US & I")), (1, None)],]
    );
    assert_eq!(
      template.split(&l("country.US")),
      [vec![(0, None), (1, l("US"))], vec![(0, l("country.US")), (1, None)],]
    );
    assert_eq!(template.split(&l("I")), vec![vec![(0, l("I")), (1, None)]]);
    assert_eq!(template.split(&None), vec![vec![(0, None), (1, None)]]);
  }

  #[test]
  fn splitting_unary_operators_works() {
    let template = t("R[$0].I & ~$1");
    assert_eq!(
      template.split(&l("R[name].I & ~Ann")),
      vec![vec![(0, None), (1, l("~(R[name].I & ~Ann)"))], vec![(0, l("name")), (1, l("Ann"))],]
    );
  }

  #[test]
  fn splitting_custom_functions_works() {
    let template = t("Tell($0, name.$1)");
    assert_eq!(template.split(&l("Tell(I, name.X)")), vec![vec![(0, l("I")), (1, l("X"))]]);
    assert_eq!(template.split(&None), vec![vec![(0, None)], vec![(1, None)]]);
  }

  #[test]
  fn binary_operators_commute() {
    let template = t("$0 & country.$1");
    assert_eq!(
      template.split(&l("country.US & I")),
      [vec![(0, l("I")), (1, l("US"))], vec![(0, l("country.US & I")), (1, None)],]
    );
  }

  #[test]
  fn parse_handles_underscore() {
    let lambda = l("abc_de_f(hi_jk.lm_no)");
    assert_eq!(lambda, l("abc_de_f(hi_jk.lm_no)"));
  }

  #[test]
  fn parse_handles_whitespace() {
    let lambda = l(" Tell ( ( R [ a ] . b & c ) | d , ( e . f | ~ ( g ) ) ) ");
    assert_eq!(lambda, l("Tell((R[a].b & c) | d, e.f | ~g)"));
  }

  #[test]
  fn stringify_sorts_terms() {
    let lambda = l("Tell(x) & f.e & (d.c | b.a)").unwrap();
    assert_eq!(lambda.stringify(), "(b.a | d.c) & Tell(x) & f.e".to_string());
  }

  #[bench]
  fn lambda_parse_benchmark(b: &mut Bencher) {
    b.iter(|| Lambda::parse("Tell(abc & def.ghi, jkl | (mno & pqr))").unwrap());
  }

  #[bench]
  fn lambda_stringify_benchmark(b: &mut Bencher) {
    let lambda = Lambda::parse("Tell(abc & def.ghi, jkl | (mno & pqr))").unwrap();
    b.iter(|| lambda.stringify());
  }

  #[bench]
  fn lambda_template_benchmark(b: &mut Bencher) {
    b.iter(|| Lambda::template("Tell(abc & def.ghi, jkl | (mno & pqr))").unwrap());
  }

  #[bench]
  fn template_merge_benchmark(b: &mut Bencher) {
    let template = Lambda::template("Tell(abc & def.ghi, jkl | (mno & pqr))").unwrap();
    b.iter(|| template.merge(&vec![]).unwrap());
  }

  #[bench]
  fn template_split_easy_benchmark(b: &mut Bencher) {
    let lambda = Some(Lambda::parse("foo & bar & baz").unwrap());
    let template = Lambda::template("$0 & $1").unwrap();
    assert_eq!(template.split(&lambda).len(), 8);
    b.iter(|| template.split(&lambda));
  }

  #[bench]
  fn template_split_hard_benchmark(b: &mut Bencher) {
    let lambda = Some(Lambda::parse("a & b & c.d").unwrap());
    let template = Lambda::template("$0 & $1 & c.$2").unwrap();
    assert_eq!(template.split(&lambda).len(), 12);
    b.iter(|| template.split(&lambda));
  }
}
