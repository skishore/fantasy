use super::super::lib::base::{HashMap, HashSet, Result};
use super::super::payload::base::{DefaultTemplate, Payload, SlotTemplate, Template, UnitTemplate};
use super::base::{Tense, Term};
use std::rc::Rc;

// We parse our grammar files into this AST, rooted at a list of RootNodes.

struct ItemNode {
  expr: ExprNode,
  index: Option<usize>,
  mark: MarkNode,
  optional: bool,
}

struct MacroNode {
  name: String,
  args: Vec<String>,
  rules: Vec<RuleNode>,
}

#[derive(Default)]
struct RuleNode {
  merge: f32,
  split: f32,
  rhs: Vec<ItemNode>,
  template: Option<String>,
  tense: HashMap<String, String>,
}

struct SymbolNode {
  lhs: String,
  root: bool,
  rules: Vec<RuleNode>,
}

enum ExprNode {
  Binding(String),
  Macro(String, Vec<ExprNode>),
  Term(TermNode),
}

#[derive(PartialEq)]
enum MarkNode {
  Max,
  Min,
  Skip,
}

enum RootNode {
  Lexer(String),
  Macro(MacroNode),
  Rules(SymbolNode),
}

enum TermNode {
  Symbol(String),
  Terminal(String),
}

// Helpers needed for converting from a basic template to the grammar's semantics callbacks.

fn get_precedence(rhs: &[ItemNode]) -> Vec<usize> {
  let mut result = vec![];
  rhs.iter().enumerate().filter(|(_, x)| x.mark == MarkNode::Max).for_each(|(i, _)| result.push(i));
  rhs.iter().enumerate().filter(|(_, x)| x.mark == MarkNode::Min).for_each(|(i, _)| result.push(i));
  if result.is_empty() { (0..rhs.len()).collect() } else { result }
}

fn get_rule<T: Payload>(lhs: usize, rhs: Vec<Term>) -> Rule<T> {
  let n = rhs.len();
  let template: Rc<dyn Template<T>> =
    if n == 1 { Rc::new(UnitTemplate {}) } else { Rc::new(DefaultTemplate {}) };
  let (merge, split) = get_semantics(n, &RuleNode::default(), template);
  Rule { lhs, rhs, merge, split, precedence: (0..n).collect(), tense: Tense::default() }
}

fn get_semantics<T: Payload>(n: usize, rule: &RuleNode, template: Rc<dyn Template<T>>) -> Pair<T> {
  let (merge, split) = (template.clone(), template.clone());
  (
    Merge {
      callback: Box::new(move |x| merge.merge(&x.iter().cloned().enumerate().collect())),
      score: rule.merge,
    },
    Split {
      callback: Box::new(move |x| {
        let mut result = vec![];
        for option in x.as_ref().map(|y| split.split(y)).unwrap_or(vec![vec![]]) {
          let mut entry = vec![None; n];
          option.into_iter().filter(|(i, _)| *i < n).for_each(|(i, y)| entry[i] = Some(y));
          result.push(entry);
        }
        result
      }),
      score: rule.split,
    },
  )
}

// TODO(skishore): We're doing an optimization here that's not completely sound.
// We're marking all terms other than optional (suffix-?) terms as being required,
// which causes SlotTemplate to skip splits that yield a default value for those terms.
//
// This required assumption fails in the case of symbols that can expand to an empty
// RHS without provided rule semantics. However, the optimization is critical, as we
// need a way to stop generation in the default case where it works.
fn get_template<T: Payload>(n: usize, rule: &RuleNode) -> Result<Rc<dyn Template<T>>> {
  let template = match &rule.template {
    Some(x) => T::template(x)?,
    None => return Ok(Rc::new(DefaultTemplate {})),
  };
  let terms = rule.rhs.iter().enumerate();
  let limit = rule.rhs.iter().filter_map(|x| x.index).max();
  let slots = if let Some(limit) = limit {
    let mut slots = vec![None; limit + 1];
    terms.for_each(|(i, x)| x.index.iter().for_each(|y| slots[*y] = Some((i, x.optional))));
    slots
  } else {
    terms.map(|(i, x)| Some((i, x.optional))).collect()
  };
  Ok(Rc::new(SlotTemplate::new(n, slots, template)))
}

fn get_warning(mut xs: Vec<String>, message: &str) -> Result<()> {
  xs.sort();
  return if xs.is_empty() { Ok(()) } else { Err(format!("{}: {}", message, xs.join(", ")))? };
}

// Logic for building a grammar from an AST.

type Grammar<T> = super::base::Grammar<Option<T>, T>;
type Lexer<T> = dyn super::base::Lexer<Option<T>, T>;
type Rule<T> = super::base::Rule<Option<T>, T>;

type Merge<T> = super::base::Semantics<dyn Fn(&[T]) -> T>;
type Split<T> = super::base::Semantics<dyn Fn(&Option<T>) -> Vec<Vec<Option<T>>>>;
type Pair<T> = (Merge<T>, Split<T>);

struct State<T: Payload> {
  binding: HashMap<String, Term>,
  grammar: Grammar<T>,
  macros: HashMap<String, Rc<MacroNode>>,
  symbol: HashMap<String, usize>,
}

impl<T: Payload> State<T> {
  fn build_binding(&mut self, binding: &str) -> Result<Term> {
    match self.binding.get(binding) {
      Some(Term::Symbol(x)) => Ok(Term::Symbol(*x)),
      Some(Term::Terminal(x)) => Ok(Term::Terminal(x.clone())),
      None => Err(format!("Unbound macro argument: {}", binding))?,
    }
  }

  fn build_expr(&mut self, expr: &ExprNode) -> Result<Term> {
    match expr {
      ExprNode::Binding(binding) => self.build_binding(binding),
      ExprNode::Macro(name, args) => self.build_macro(name, args),
      ExprNode::Term(TermNode::Symbol(x)) => Ok(Term::Symbol(self.get_symbol(x))),
      ExprNode::Term(TermNode::Terminal(x)) => Ok(Term::Terminal(x.clone())),
    }
  }

  fn build_macro(&mut self, name: &str, args: &[ExprNode]) -> Result<Term> {
    let terms = args.iter().map(|x| self.build_expr(x)).collect::<Result<Vec<_>>>()?;
    let names: Vec<_> = terms.iter().map(|x| self.get_name(x)).collect();
    let symbol = format!("{}[{}]", name, names.join(", "));
    if !self.symbol.contains_key(&symbol) {
      let m = self.macros.get(name).cloned().ok_or(format!("Unbound macro: {}", name))?;
      if terms.len() != m.args.len() {
        return Err(format!("{} got {} arguments; expected: {}", name, terms.len(), m.args.len()))?;
      }
      let mut b: HashMap<_, _> = m.args.iter().zip(terms).map(|(x, y)| (x.clone(), y)).collect();
      std::mem::swap(&mut self.binding, &mut b);
      self.process_rules(&symbol, &m.rules)?;
      std::mem::swap(&mut self.binding, &mut b);
    }
    Ok(Term::Symbol(self.get_symbol(&symbol)))
  }

  fn build_option(&mut self, term: Term) -> Term {
    let name = format!("{}?", self.get_name(&term));
    if !self.symbol.contains_key(&name) {
      let symbol = self.get_symbol(&name);
      for rhs in vec![vec![], vec![term]] {
        self.grammar.rules.push(get_rule(symbol, rhs));
      }
    }
    Term::Symbol(*self.symbol.get(&name).unwrap())
  }

  fn build_term(&mut self, item: &ItemNode) -> Result<Term> {
    let base = self.build_expr(&item.expr)?;
    if item.optional { Ok(self.build_option(base)) } else { Ok(base) }
  }

  fn get_name(&mut self, term: &Term) -> String {
    match term {
      Term::Symbol(x) => self.grammar.names[*x].clone(),
      Term::Terminal(x) => x.clone(),
    }
  }

  fn get_symbol(&mut self, name: &str) -> usize {
    let names = &mut self.grammar.names;
    *self.symbol.entry(name.to_string()).or_insert_with(|| {
      names.push(name.to_string());
      names.len() - 1
    })
  }

  fn process_macro(&mut self, x: MacroNode) -> Result<()> {
    match self.macros.insert(x.name.clone(), Rc::new(x)) {
      Some(x) => Err(format!("Duplicate macro: {}", x.name))?,
      None => Ok(()),
    }
  }

  fn process_rules(&mut self, lhs: &str, rules: &[RuleNode]) -> Result<()> {
    let lhs = self.get_symbol(lhs);
    rules.iter().try_for_each(|y| {
      let n = y.rhs.len();
      let precedence = get_precedence(&y.rhs);
      let (merge, split) = get_semantics(n, y, get_template(n, y)?);
      let rhs = y.rhs.iter().map(|z| self.build_term(z)).collect::<Result<Vec<_>>>()?;
      let tense = Tense::new(&y.tense)?;
      self.grammar.rules.push(Rule { lhs, rhs, merge, split, precedence, tense });
      Ok(())
    })
  }

  fn process_start(&mut self, x: &str) {
    let lhs = self.get_symbol(x);
    self.grammar.rules.push(get_rule(0, vec![Term::Symbol(lhs)]));
  }

  fn validate(self) -> Result<Grammar<T>> {
    // Collect all the symbol, text, and type terms in this grammar.
    let mut lhs = HashSet::default();
    let mut rhs = HashSet::default();
    let mut terminals = HashSet::default();
    rhs.insert(self.grammar.start);
    self.grammar.rules.iter().for_each(|x| {
      lhs.insert(x.lhs);
      x.rhs.iter().for_each(|y| match y {
        Term::Symbol(z) => std::mem::drop(rhs.insert(*z)),
        Term::Terminal(z) => std::mem::drop(terminals.insert(z.clone())),
      });
    });

    // Throw if a symbol is LHS- or RHS-only, or if a terminal is unknown to the lexer.
    {
      let Grammar { lexer, names, .. } = &self.grammar;
      let dummy = Some(T::base_lex("dummy"));
      let check = |x: &str| lexer.unlex(x, &None).is_empty() && lexer.unlex(x, &dummy).is_empty();
      let dead_end = rhs.iter().filter(|x| !lhs.contains(*x)).map(|x| names[*x].clone());
      let unreachable = lhs.iter().filter(|x| !rhs.contains(*x)).map(|x| names[*x].clone());
      let unknown = terminals.into_iter().filter(|x| check(x));
      get_warning(dead_end.collect(), "Dead-end symbols")?;
      get_warning(unreachable.collect(), "Unreachable symbols")?;
      get_warning(unknown.collect(), "Unknown terminals")?;
    }
    Ok(self.grammar)
  }
}

// A parser that builds up the AST above.

fn parse(input: &str) -> Result<Vec<RootNode>> {
  use lib::combine::*;

  enum DataNode {
    Merge(f32),
    Split(f32),
    Template(String),
    Tense(String, String),
  }

  thread_local! {
    static PARSER: Parser<Vec<RootNode>> = {
      let comment = regexp(r#"#.*"#, |_| ());
      let ws = separate(regexp(r#"\s*"#, |_| ()), comment, 0);
      let id = regexp("[a-zA-Z_]+", |x| x.to_string());
      let st = |x| string(x, |_| ());
      let prefix = |x: &'static str| seq2((st(x), &id), move |y| format!("{}{}", x, y.1));
      let (binding, symbol, terminal) = (prefix("@"), prefix("$"), prefix("%"));

      // Parser for various primitive types.
      let index = regexp("(0|[1-9][0-9]*)", |x| x.parse::<usize>().unwrap());
      let number = any(&[
        regexp(r#"-?(?:[0-9]|[1-9][0-9]+)?(?:\.[0-9]+)\b"#, |x| x.parse::<f32>().unwrap()),
        regexp(r#"-?(?:[0-9]|[1-9][0-9]+)\b"#, |x| x.parse::<f32>().unwrap()),
      ]);
      let string = any(&[
        regexp(r#""[^"]*""#, |x| x[1..x.len()-1].to_string()),
        regexp(r#"'[^']*'"#, |x| x[1..x.len()-1].to_string()),
      ]);

      // Parsers for term and expr expressions. An expr can be a binding, macro, or term.
      let commas = seq3((&ws, st(","), &ws), |_| ());
      let term = any(&[
        map(&symbol, TermNode::Symbol),
        map(&id, TermNode::Terminal),
        map(terminal, TermNode::Terminal),
      ]);
      let (cell, expr) = lazy();
      cell.replace(any(&[
        map(&binding, ExprNode::Binding),
        seq4((&id, st("["), separate(&expr, &commas, 1), st("]")), |x| ExprNode::Macro(x.0, x.2)),
        map(term, ExprNode::Term),
      ]));

      // A parser for an RHS item, which is a marked-up expr.
      let mark = any(&[
        map(st("*"), |_| MarkNode::Max),
        map(st("^"), |_| MarkNode::Min),
        succeed(|| MarkNode::Skip),
      ]);
      let item = seq4(
        (expr, opt(seq2((st(":"), index), |x| x.1)), opt(st("?")), mark),
        |x| ItemNode { expr: x.0, index: x.1, mark: x.3, optional: x.2.is_some() }
      );

      // A parser for a rule's associated metadata.
      let tense = seq3((&id, &ws, &id), |x| x);
      let entry = any(&[
        seq3((st("<"), &ws, &number), |x| DataNode::Merge(x.2)),
        seq3((st(">"), &ws, &number), |x| DataNode::Split(x.2)),
        seq3((st("="), &ws, &string), |x| DataNode::Template(x.2)),
        seq3((st("?"), &ws, tense), |x| DataNode::Tense((x.2).0, (x.2).2)),
      ]);
      let tuple = seq3((st("("), entry, st(")")), |x| x.1);
      let metas = separate(tuple, &ws, 0);

      // A parser for a complete list of RHS options for a macro or a rule.
      let none = map(st("NONE"), |_| vec![]);
      let list = any(&[none, separate(item, st(" "), 1)]);
      let sign = any(&[
        map(st("<"), |_| Some(DataNode::Split(std::f32::NEG_INFINITY))),
        map(st(">"), |_| Some(DataNode::Merge(std::f32::NEG_INFINITY))),
        map(st("="), |_| None),
      ]);
      let once = seq3((list, &ws, &metas), |x| x);
      let side = seq3((sign, &ws, once), |x| x);
      let rule = seq3((&metas, &ws, separate(side, &ws, 1)), |(rule_data, _, sides)| {
        let rules = sides.into_iter().map(|(sign_data, _, (rhs, _, side_data))| {
          let mut rule = RuleNode { rhs, ..RuleNode::default() };
          let data = rule_data.iter().chain(sign_data.iter()).chain(side_data.iter());
          data.for_each(|z| match z {
            DataNode::Merge(x) => rule.merge = *x,
            DataNode::Split(x) => rule.split = *x,
            DataNode::Template(x) => rule.template = Some(x.clone()),
            DataNode::Tense(x, y) => std::mem::drop(rule.tense.insert(x.clone(), y.clone())),
          });
          rule
        });
        rules.collect::<Vec<_>>()
      });

      // Our top-level grammar parser.
      let args = seq3((st("["), separate(binding, commas, 1), st("]")), |x| x.1);
      let update = any(&[
        regexp(r#"lexer: ```[\s\S]*```"#, |x| RootNode::Lexer(x[10..x.len() - 3].to_string())),
        seq4((&id, args, &ws, &rule), |x| RootNode::Macro(MacroNode { name: x.0, args: x.1, rules: x.3 })),
        seq4((&symbol, opt(st("!")), &ws, &rule), |x| RootNode::Rules(SymbolNode { lhs: x.0, root: x.1.is_some(), rules: x.3 })),
      ]);
      seq3((&ws, separate(update, &ws, 1), &ws), |x| x.1)
    };
  }

  PARSER.with(|x| x.parse(input))
}

// Our public API is a simple function.

pub fn compile<F: Fn(&str) -> Result<Box<Lexer<T>>>, T: Payload>(
  input: &str,
  lexer: F,
) -> Result<Grammar<T>> {
  let (mut lexers, mut macros, mut symbol) = (vec![], vec![], vec![]);
  parse(input)?.into_iter().for_each(|x| match x {
    RootNode::Lexer(x) => lexers.push(x),
    RootNode::Macro(x) => macros.push(x),
    RootNode::Rules(x) => symbol.push(x),
  });
  if lexers.len() != 1 {
    Err(format!("Expected: 1 lexer block; got: {}", lexers.len()))?;
  }

  let mut state: State<T> = State {
    binding: HashMap::default(),
    grammar: Grammar { lexer: lexer(&lexers[0])?, names: vec![], rules: vec![], start: 0 },
    macros: HashMap::default(),
    symbol: HashMap::default(),
  };

  state.get_symbol("$ROOT");
  macros.into_iter().try_for_each(|x| state.process_macro(x))?;
  symbol.iter().try_for_each(|x| state.process_rules(&x.lhs, &x.rules))?;
  symbol.iter().filter(|x| x.root).for_each(|x| state.process_start(&x.lhs));
  state.validate()
}

#[cfg(test)]
mod tests {
  use super::super::super::hindi::lexer::HindiLexer;
  use super::super::super::nlu::corrector::Corrector;
  use super::super::super::nlu::generator::Generator;
  use super::super::super::nlu::parser::Parser;
  use super::super::super::payload::lambda::Lambda;
  use super::*;
  use test::Bencher;

  fn make_grammar() -> Result<Grammar<Lambda>> {
    let file = "src/hindi/hindi.grammar";
    let data = std::fs::read_to_string(file).unwrap();
    let grammar = compile(&data, HindiLexer::new);
    Ok(grammar.map_err(|x| format!("Failed to compile grammar: {}\n\n{:?}", file, x))?)
  }

  #[test]
  fn smoke_test() {
    make_grammar().unwrap();
  }

  #[bench]
  fn correction_benchmark(b: &mut Bencher) {
    let grammar = make_grammar().unwrap();
    let tree = Parser::new(&grammar).parse("do accha acche larki ko pani chahie").unwrap();
    let mut rng = rand::SeedableRng::from_seed([17; 32]);
    let corrector = Corrector::new(&grammar);
    b.iter(|| corrector.correct(&mut rng, &tree));
  }

  #[bench]
  fn generation_benchmark(b: &mut Bencher) {
    let grammar = make_grammar().unwrap();
    let generator = Generator::new(&grammar);
    let mut rng = rand::SeedableRng::from_seed([17; 32]);
    let semantics = Some(Lambda::parse("Tell(owner.I & type.child, want.type.water)").unwrap());
    b.iter(|| generator.generate(&mut rng, &semantics).unwrap());
  }

  #[bench]
  fn parsing_benchmark(b: &mut Bencher) {
    let grammar = make_grammar().unwrap();
    let parser = Parser::new(&grammar);
    b.iter(|| parser.parse("meri bacche ko pani chahie").unwrap());
  }
}
