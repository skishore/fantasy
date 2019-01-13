use std::rc::Rc;

pub type Args<T> = Vec<(usize, T)>;

pub trait Template<T> {
  fn merge(&self, xs: &Args<T>) -> T;
  fn split(&self, x: T) -> Vec<Args<T>>;
}

// A lambda DCS type used for utterance semantics.

type OptionLambda = Option<Rc<Lambda>>;

#[derive(Clone, Copy, PartialEq)]
pub enum Binary {
  Conjunction,
  Disjunction,
  Join,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Unary {
  Not,
  Reverse,
}

pub enum Lambda {
  Binary(Binary, Vec<Rc<Lambda>>),
  Custom(String, Vec<Rc<Lambda>>),
  Terminal(String),
  Unary(Unary, Rc<Lambda>),
}

impl Lambda {
  pub fn parse(input: &str) -> Result<Rc<Lambda>, String> {
    parse(input)
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

fn parse(input: &str) -> Result<Rc<Lambda>, String> {
  use combine::*;
  type Node = Parser<Rc<Lambda>>;
  lazy_static! {
    static ref kParser: Node = {
      let ws = regexp(r#"\s*"#, |_| ());
      let id = regexp("[a-zA-Z0-9_]+", |x| x.to_string()).skip(ws.clone());
      let st = |x| string(x, |_| ()).skip(ws.clone());

      let base = |x: Node| {
        any(vec![
          seq4((st("R"), st("["), x.clone(), st("]")), |x| {
            Rc::new(Lambda::Unary(Unary::Reverse, x.2))
          }),
          seq2(
            (id.clone(), opt(st("(").then(x.clone().separate(st(","), 0)).skip(st(")")))),
            |x| match x.1 {
              Some(xs) => Rc::new(Lambda::Custom(x.0, xs)),
              None => Rc::new(Lambda::Terminal(x.0)),
            },
          ),
          seq3((st("("), x.clone(), st(")")), |x| x.1),
        ])
      };

      let binaries = |ops: Vec<(&'static str, Binary)>| {
        move |x: Node| {
          let mut options = vec![];
          for (name, op) in ops.iter() {
            let op = op.clone();
            options.push(st(name).then(x.clone()).repeat(1).map(move |x| Some((op, x))));
          }
          options.push(succeed(|| None));
          seq2((x, any(options)), |x| match x.1 {
            Some((op, mut xs)) => {
              let xs: Vec<_> = std::iter::once(x.0).chain(xs.drain(..)).collect();
              Rc::new(Lambda::Binary(op, xs))
            }
            None => x.0,
          })
        }
      };

      let unary = |name: &'static str, op: Unary| {
        move |x: Node| x.clone().or(seq2((st(name), x), move |x| Rc::new(Lambda::Unary(op, x.1))))
      };

      let (cell, root) = lazy();
      let precedence: Vec<Box<Fn(Node) -> Node>> = vec![
        Box::new(base),
        Box::new(binaries(vec![(".", Binary::Join)])),
        Box::new(unary("~", Unary::Not)),
        Box::new(binaries(vec![("&", Binary::Conjunction), ("|", Binary::Disjunction)])),
      ];
      cell.replace(precedence.iter().fold(root.clone(), |x, f| f(x)));
      root
    };
  }
  kParser.parse(input)
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
  use combine::*;
  type Node = Parser<Rc<Template<OptionLambda>>>;
  lazy_static! {
    static ref kParser: Node = {
      let ws = regexp(r#"\s*"#, |_| ());
      let id = regexp("[a-zA-Z0-9_]+", |x| x.to_string()).skip(ws.clone());
      let st = |x| string(x, |_| ()).skip(ws.clone());
      let number = regexp("(0|[1-9][0-9]*)", |x| x.parse::<usize>().unwrap()).skip(ws.clone());

      let base = |x: Node| {
        any(vec![
          seq4((st("R"), st("["), x.clone(), st("]")), |x| helpers::unary(Unary::Reverse, x.2)),
          seq2(
            (id.clone(), opt(st("(").then(x.clone().separate(st(","), 0)).skip(st(")")))),
            |x| match x.1 {
              Some(xs) => helpers::custom(x.0, xs),
              None => helpers::terminal(x.0),
            },
          ),
          seq3((st("("), x.clone(), st(")")), |x| x.1),
          seq2((st("$"), number.clone()), |x| helpers::variable(x.1)),
        ])
      };

      let binaries = |ops: Vec<(&'static str, Binary)>| {
        move |x: Node| {
          let mut options = vec![];
          for (name, op) in ops.iter() {
            let op = op.clone();
            options.push(st(name).then(x.clone()).repeat(1).map(move |x| Some((op, x))));
          }
          options.push(succeed(|| None));
          seq2((x, any(options)), |x| match x.1 {
            Some((op, mut xs)) => xs.drain(..).fold(x.0, |acc, x| helpers::binary(op, acc, x)),
            None => x.0,
          })
        }
      };

      let unary = |name: &'static str, op: Unary| {
        move |x: Node| x.clone().or(seq2((st(name), x), move |x| helpers::unary(op, x.1)))
      };

      let (cell, root) = lazy();
      let precedence: Vec<Box<Fn(Node) -> Node>> = vec![
        Box::new(base),
        Box::new(binaries(vec![(".", Binary::Join)])),
        Box::new(unary("~", Unary::Not)),
        Box::new(binaries(vec![("&", Binary::Conjunction), ("|", Binary::Disjunction)])),
      ];
      cell.replace(precedence.iter().fold(root.clone(), |x, f| f(x)));
      root
    };
  }
  kParser.parse(input)
}

// Templates that operate on lambda DCS expressions.

fn append<T>(xs: &[Args<T>], ys: &[Args<T>], zs: &mut Vec<Args<T>>)
where
  T: Clone,
{
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
    x
  })
}

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
  fn split(&self, x: OptionLambda) -> Vec<Args<OptionLambda>> {
    let base = expand(self.0, x);
    let commutes = self.0.data().commutes;
    if !commutes && base.is_empty() {
      let mut x1 = self.1.split(None);
      let mut x2 = self.2.split(None);
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
      let x1 = self.1.split(collapse(self.0, xs.0));
      let x2 = self.2.split(collapse(self.0, xs.1));
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
  fn split(&self, x: OptionLambda) -> Vec<Args<OptionLambda>> {
    match x {
      Some(x) => {
        if let Lambda::Custom(ref y, ref ys) = *x {
          if *y == self.0 && ys.len() == self.1.len() {
            return self.1.iter().enumerate().fold(vec![vec![]], |acc, (i, x)| {
              let mut result = vec![];
              append(&acc, &x.split(Some(ys[i].clone())), &mut result);
              result
            });
          }
        }
        vec![]
      }
      None => {
        let mut result = vec![];
        self.1.iter().for_each(|x| result.append(&mut x.split(None)));
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
  fn split(&self, x: OptionLambda) -> Vec<Args<OptionLambda>> {
    let matched = x.map(|y| match *y {
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
  fn split(&self, x: OptionLambda) -> Vec<Args<OptionLambda>> {
    self.1.split(involute(self.0, x))
  }
}

struct VariableTemplate(usize);

impl Template<OptionLambda> for VariableTemplate {
  fn merge(&self, xs: &Args<OptionLambda>) -> OptionLambda {
    xs.iter().filter_map(|(i, x)| if *i == self.0 { x.clone() } else { None }).next()
  }
  fn split(&self, x: OptionLambda) -> Vec<Args<OptionLambda>> {
    vec![vec![(self.0, x)]]
  }
}

mod helpers {
  use super::*;
  type Node = Rc<Template<OptionLambda>>;

  pub fn binary(op: Binary, a: Node, b: Node) -> Node {
    Rc::new(BinaryTemplate(op, a, b))
  }

  pub fn custom(op: String, args: Vec<Node>) -> Node {
    Rc::new(CustomTemplate(op.to_string(), args))
  }

  pub fn terminal(x: String) -> Node {
    Rc::new(TerminalTemplate(x.clone(), Some(Rc::new(Lambda::Terminal(x)))))
  }

  pub fn unary(op: Unary, a: Node) -> Node {
    Rc::new(UnaryTemplate(op, a))
  }

  pub fn variable(i: usize) -> Node {
    Rc::new(VariableTemplate(i))
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use test::Bencher;

  #[bench]
  fn lambda_parser_benchmark(b: &mut Bencher) {
    b.iter(|| Lambda::parse("Test(abc & def.ghi, jkl | (mno & pqr))").unwrap());
  }

  #[bench]
  fn template_parse_benchmark(b: &mut Bencher) {
    b.iter(|| Lambda::template("Test(abc & def.ghi, jkl | (mno & pqr))").unwrap());
  }

  #[bench]
  fn template_merge_benchmark(b: &mut Bencher) {
    let template = Lambda::template("Test(abc & def.ghi, jkl | (mno & pqr))").unwrap();
    b.iter(|| template.merge(&vec![]).unwrap());
  }

  #[bench]
  fn split_benchmark_easy(b: &mut Bencher) {
    let lambda = Some(Lambda::parse("foo & bar & baz").unwrap());
    let template = Lambda::template("$0 & $1").unwrap();
    assert_eq!(template.split(lambda.clone()).len(), 8);
    b.iter(|| template.split(lambda.clone()));
  }

  #[bench]
  fn split_benchmark_hard(b: &mut Bencher) {
    let lambda = Some(Lambda::parse("a & b & c.d").unwrap());
    let template = Lambda::template("$0 & $1 & c.$2").unwrap();
    assert_eq!(template.split(lambda.clone()).len(), 12);
    b.iter(|| template.split(lambda.clone()));
  }
}
