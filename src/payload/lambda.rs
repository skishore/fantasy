use super::super::lib::base::Result;
use super::base::{append, Args, Payload, Template, VariableTemplate};
use std::cell::UnsafeCell;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

// The core lambda DCS expression type.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Binary {
  Conjunction,
  Disjunction,
  Join,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Unary {
  Not,
  Reverse,
}

#[derive(Debug, Eq, PartialEq)]
pub enum Expr {
  Binary(Binary, Vec<Lambda>),
  Custom(String, Vec<Lambda>),
  Terminal(String),
  Unary(Unary, Lambda),
  Unknown,
}

// The Lambda type caches an Expr's string representation.

#[derive(Clone, Debug)]
pub struct Lambda(Rc<(Expr, UnsafeCell<String>)>);

impl Lambda {
  fn new(expr: Expr) -> Self {
    Lambda(Rc::new((expr, UnsafeCell::default())))
  }

  pub fn expr(&self) -> &Expr {
    &(self.0).0
  }

  pub fn repr(&self) -> &str {
    let x = unsafe { &mut *(self.0).1.get() };
    if x.is_empty() {
      *x = stringify(self.expr());
    }
    x
  }
}

impl Default for Lambda {
  fn default() -> Self {
    thread_local! { static DEFAULT: Lambda = Lambda::new(Expr::Unknown) };
    DEFAULT.with(|x| x.clone())
  }
}

impl Eq for Lambda {}

impl Hash for Lambda {
  fn hash<H: Hasher>(&self, h: &mut H) {
    self.repr().hash(h);
  }
}

impl PartialEq for Lambda {
  fn eq(&self, other: &Self) -> bool {
    self.repr() == other.repr()
  }
}

impl Payload for Lambda {
  fn base_lex(input: &str) -> Self {
    Lambda::new(Expr::Terminal(input.to_string()))
  }

  fn base_unlex(&self) -> Option<&str> {
    return if let Expr::Terminal(x) = self.expr() { Some(x.as_str()) } else { None };
  }

  fn empty(&self) -> bool {
    *self.expr() == Expr::Unknown
  }

  fn parse(input: &str) -> Result<Self> {
    if input == "-" {
      return Ok(Self::default());
    }
    let base = template(input)?.merge(&vec![]);
    return if base.empty() { Err("Empty lambda expression!")? } else { Ok(base) };
  }

  fn template(input: &str) -> Result<Box<Template<Self>>> {
    template(input)
  }
}

// Helpers used to implement the Payload trait for Lambda.

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

fn stringify(lambda: &Expr) -> String {
  match lambda {
    Expr::Binary(op, children) => {
      let Operator { commutes, precedence, text } = op.data();
      let mut base: Vec<_> = children.into_iter().map(|x| stringify_wrap(x, precedence)).collect();
      if commutes {
        base.sort();
      }
      base.join(&text)
    }
    Expr::Custom(name, children) => {
      let base: Vec<_> = children.into_iter().map(|x| x.repr()).collect();
      format!("{}({})", name, base.join(", "))
    }
    Expr::Terminal(name) => name.to_string(),
    Expr::Unary(op, child) => {
      let Operator { precedence, text, .. } = op.data();
      let base = stringify_wrap(child, precedence);
      match op {
        Unary::Reverse => format!("{}[{}]", text, base),
        _ => format!("{}{}", text, base),
      }
    }
    Expr::Unknown => "-".to_string(),
  }
}

fn stringify_wrap(lambda: &Lambda, context: u32) -> String {
  let parens = match lambda.expr() {
    Expr::Binary(op, _) => op.data().precedence >= context,
    Expr::Unary(op, _) => op.data().precedence >= context,
    _ => false,
  };
  return if parens { format!("({})", lambda.repr()) } else { lambda.repr().to_string() };
}

fn template(input: &str) -> Result<Box<Template<Lambda>>> {
  use super::super::lib::combine::*;

  type Node = Box<Template<Lambda>>;

  pub fn wrap(x: impl Template<Lambda> + 'static) -> Node {
    Box::new(x)
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
              None => wrap(TerminalTemplate(x.0.clone(), Lambda::new(Expr::Terminal(x.0)))),
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

struct BinaryTemplate(Binary, Box<Template<Lambda>>, Box<Template<Lambda>>);

impl Template<Lambda> for BinaryTemplate {
  fn merge(&self, xs: &Args<Lambda>) -> Lambda {
    let mut x1 = expand(self.0, &self.1.merge(xs));
    let mut x2 = expand(self.0, &self.2.merge(xs));
    if self.0.data().commutes || (!x1.is_empty() && !x2.is_empty()) {
      x1.append(&mut x2);
      collapse(self.0, x1)
    } else {
      Lambda::default()
    }
  }
  fn split(&self, x: &Lambda) -> Vec<Args<Lambda>> {
    let base = expand(self.0, x);
    let commutes = self.0.data().commutes;
    if !commutes && base.is_empty() {
      let default = Lambda::default();
      let mut x1 = self.1.split(&default);
      let mut x2 = self.2.split(&default);
      return x1.drain(..).chain(x2.drain(..)).collect();
    }
    let bits: Vec<_> = if commutes {
      (0..(1 << base.len())).collect()
    } else {
      (0..(base.len() - 1)).map(|i| (1 << (i + 1)) - 1).collect()
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

struct CustomTemplate(String, Vec<Box<Template<Lambda>>>);

impl Template<Lambda> for CustomTemplate {
  fn merge(&self, xs: &Args<Lambda>) -> Lambda {
    let xs: Vec<_> = self.1.iter().map(|x| x.merge(xs)).filter(|x| !x.empty()).collect();
    if xs.len() < self.1.len() {
      Lambda::default()
    } else {
      Lambda::new(Expr::Custom(self.0.clone(), xs))
    }
  }
  fn split(&self, x: &Lambda) -> Vec<Args<Lambda>> {
    match x.expr() {
      Expr::Custom(name, children) if *name == self.0 && children.len() == self.1.len() => {
        self.1.iter().enumerate().fold(vec![vec![]], |acc, (i, x)| {
          let mut result = vec![];
          append(&acc, &x.split(&children[i]), &mut result);
          result
        })
      }
      Expr::Unknown => {
        let default = Lambda::default();
        let mut result = Vec::with_capacity(self.1.len());
        self.1.iter().for_each(|x| result.append(&mut x.split(&default)));
        result
      }
      _ => vec![],
    }
  }
}

struct TerminalTemplate(String, Lambda);

impl Template<Lambda> for TerminalTemplate {
  fn merge(&self, _: &Args<Lambda>) -> Lambda {
    self.1.clone()
  }
  fn split(&self, x: &Lambda) -> Vec<Args<Lambda>> {
    match x.expr() {
      Expr::Terminal(name) if *name == self.0 => vec![vec![]],
      _ => vec![],
    }
  }
}

struct UnaryTemplate(Unary, Box<Template<Lambda>>);

impl Template<Lambda> for UnaryTemplate {
  fn merge(&self, xs: &Args<Lambda>) -> Lambda {
    involute(self.0, &self.1.merge(xs))
  }
  fn split(&self, x: &Lambda) -> Vec<Args<Lambda>> {
    self.1.split(&involute(self.0, x))
  }
}

// Internal helpers for the templates above.

fn collapse(op: Binary, mut x: Vec<Lambda>) -> Lambda {
  match x.len() {
    0 | 1 => x.pop().unwrap_or_default(),
    _ => Lambda::new(Expr::Binary(op, x)),
  }
}

fn expand(x: Binary, y: &Lambda) -> Vec<Lambda> {
  match y.expr() {
    Expr::Binary(op, children) if *op == x => children.to_vec(),
    Expr::Unknown => vec![],
    _ => vec![y.clone()],
  }
}

fn involute(x: Unary, y: &Lambda) -> Lambda {
  match y.expr() {
    Expr::Unary(op, child) if *op == x => child.clone(),
    Expr::Unknown => y.clone(),
    _ => Lambda::new(Expr::Unary(x, y.clone())),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  fn l(input: &str) -> Lambda {
    Lambda::parse(input).unwrap()
  }

  fn t(input: &str) -> Box<Template<Lambda>> {
    Lambda::template(input).unwrap()
  }

  fn empty() -> Vec<Args<Lambda>> {
    vec![]
  }

  fn merge(template: &Template<Lambda>, args: Vec<Lambda>) -> Lambda {
    template.merge(&args.into_iter().enumerate().collect())
  }

  fn none() -> Lambda {
    Lambda::default()
  }

  #[test]
  fn merging_joins_works() {
    let template = t("color.$0");
    assert_eq!(merge(&*template, vec![l("red")]), l("color.red"));
    assert_eq!(merge(&*template, vec![none()]), none());
  }

  #[test]
  fn merging_binary_operators_works() {
    let template = t("$0 & country.$1");
    assert_eq!(merge(&*template, vec![l("I"), l("US")]), l("I & country.US"));
    assert_eq!(merge(&*template, vec![l("I"), none()]), l("I"));
    assert_eq!(merge(&*template, vec![none(), l("US")]), l("country.US"));
    assert_eq!(merge(&*template, vec![none(), none()]), none());
  }

  #[test]
  fn merging_unary_operators_works() {
    let template = t("R[$0].I & ~$1");
    assert_eq!(merge(&*template, vec![l("name"), l("X")]), l("R[name].I & ~X"));
    assert_eq!(merge(&*template, vec![l("R[name]"), l("X")]), l("name.I & ~X"));
    assert_eq!(merge(&*template, vec![l("name"), l("~X")]), l("R[name].I & X"));
    assert_eq!(merge(&*template, vec![l("R[name]"), l("~X")]), l("name.I & X"));
    assert_eq!(merge(&*template, vec![l("name"), none()]), l("R[name].I"));
    assert_eq!(merge(&*template, vec![none(), l("~X")]), l("X"));
    assert_eq!(merge(&*template, vec![none(), none()]), none());
  }

  #[test]
  fn merging_custom_functions_works() {
    let template = t("Tell($0, name.$1)");
    assert_eq!(merge(&*template, vec![l("I"), l("X")]), l("Tell(I, name.X)"));
    assert_eq!(merge(&*template, vec![l("I"), none()]), none());
    assert_eq!(merge(&*template, vec![none(), l("X")]), none());
    assert_eq!(merge(&*template, vec![none(), none()]), none());
  }

  #[test]
  fn splitting_joins_works() {
    let template = t("color.$0");
    assert_eq!(template.split(&l("type.food")), empty());
    assert_eq!(template.split(&l("color.red")), [[(0, l("red"))]]);
    assert_eq!(template.split(&none()), [[(0, none())]]);
  }

  #[test]
  fn splitting_multiple_joins_works() {
    let template = t("$0.$1");
    assert_eq!(
      template.split(&l("a.b.c")),
      [[(0, l("a")), (1, l("b.c"))], [(0, l("a.b")), (1, l("c"))]],
    );
  }

  #[test]
  fn splitting_binary_operators_works() {
    let template = t("$0 & country.$1");
    assert_eq!(
      template.split(&l("I & country.US")),
      [[(0, l("I")), (1, l("US"))], [(0, l("I & country.US")), (1, none())]]
    );
    assert_eq!(
      template.split(&l("country.US & I")),
      [[(0, l("I")), (1, l("US"))], [(0, l("country.US & I")), (1, none())]]
    );
    assert_eq!(
      template.split(&l("country.US")),
      [[(0, none()), (1, l("US"))], [(0, l("country.US")), (1, none())]]
    );
    assert_eq!(template.split(&l("I")), [[(0, l("I")), (1, none())]]);
    assert_eq!(template.split(&none()), [[(0, none()), (1, none())]]);
  }

  #[test]
  fn splitting_unary_operators_works() {
    let template = t("R[$0].I & ~$1");
    assert_eq!(
      template.split(&l("R[name].I & ~Ann")),
      [[(0, none()), (1, l("~(R[name].I & ~Ann)"))], [(0, l("name")), (1, l("Ann"))]]
    );
  }

  #[test]
  fn splitting_custom_functions_works() {
    let template = t("Tell($0, name.$1)");
    assert_eq!(template.split(&l("Ask(you.name)")), empty());
    assert_eq!(template.split(&l("Tell(I, name.X)")), [[(0, l("I")), (1, l("X"))]]);
    assert_eq!(template.split(&none()), [[(0, none())], [(1, none())]]);
  }

  #[test]
  fn binary_operators_commute() {
    let template = t("$0 & country.$1");
    assert_eq!(
      template.split(&l("country.US & I")),
      [[(0, l("I")), (1, l("US"))], [(0, l("country.US & I")), (1, none())]]
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
  fn repr_sorts_terms() {
    let lambda = l("Tell(x) & f.e & (d.c | b.a)");
    assert_eq!(lambda.repr(), "(b.a | d.c) & Tell(x) & f.e");
  }

  #[bench]
  fn parse_benchmark(b: &mut Bencher) {
    b.iter(|| Lambda::parse("Tell(abc & def.ghi, jkl | (mno & pqr))").unwrap());
  }

  #[bench]
  fn stringify_benchmark(b: &mut Bencher) {
    let lambda = Lambda::parse("Tell(abc & def.ghi, jkl | (mno & pqr))").unwrap();
    b.iter(|| stringify(lambda.expr()));
  }

  #[bench]
  fn template_benchmark(b: &mut Bencher) {
    b.iter(|| Lambda::template("Tell(abc & def.ghi, jkl | (mno & pqr))").unwrap());
  }

  #[bench]
  fn template_merge_benchmark(b: &mut Bencher) {
    let template = Lambda::template("Tell(abc & def.ghi, jkl | (mno & pqr))").unwrap();
    assert!(!template.merge(&vec![]).empty());
    b.iter(|| template.merge(&vec![]));
  }

  #[bench]
  fn template_split_easy_benchmark(b: &mut Bencher) {
    let lambda = Lambda::parse("foo & bar & baz").unwrap();
    let template = Lambda::template("$0 & $1").unwrap();
    assert_eq!(template.split(&lambda).len(), 8);
    b.iter(|| template.split(&lambda));
  }

  #[bench]
  fn template_split_hard_benchmark(b: &mut Bencher) {
    let lambda = Lambda::parse("a & b & c.d").unwrap();
    let template = Lambda::template("$0 & $1 & c.$2").unwrap();
    assert_eq!(template.split(&lambda).len(), 12);
    b.iter(|| template.split(&lambda));
  }
}
