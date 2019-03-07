use super::super::lib::base::Result;
use super::super::payload::base::{Args, Payload, Template};
use super::base::Term;
use rustc_hash::FxHashMap;
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
  tense: FxHashMap<String, String>,
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

struct DefaultTemplate {}

impl<T: Payload> Template<T> for DefaultTemplate {
  fn merge(&self, _: &Args<T>) -> T {
    T::default()
  }
  fn split(&self, x: &T) -> Vec<Args<T>> {
    return if x.is_default() { vec![vec![]] } else { vec![] };
  }
}

struct UnitTemplate {}

impl<T: Payload> Template<T> for UnitTemplate {
  fn merge(&self, xs: &Args<T>) -> T {
    xs.iter().filter(|(i, _)| *i == 0).next().map(|(_, x)| x.clone()).unwrap_or_default()
  }
  fn split(&self, x: &T) -> Vec<Args<T>> {
    vec![vec![(0, x.clone())]]
  }
}

fn get_semantics<T: Payload>(rule: &RuleNode, template: Rc<Template<T>>) -> (Merge<T>, Split<T>) {
  let n = rule.rhs.len();
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

// Helpers to create a single term, which involves expanding macros.

fn get_precedence(rhs: &[ItemNode]) -> Vec<usize> {
  let mut result = vec![];
  rhs.iter().enumerate().filter(|(_, x)| x.mark == MarkNode::Max).for_each(|(i, _)| result.push(i));
  rhs.iter().enumerate().filter(|(_, x)| x.mark == MarkNode::Min).for_each(|(i, _)| result.push(i));
  return if result.is_empty() { (0..rhs.len()).collect() } else { result };
}

fn get_rule<T: Payload>(lhs: usize, rhs: Vec<Term>) -> Rule<T> {
  let n = rhs.len();
  let template: Rc<Template<T>> =
    if n == 1 { Rc::new(UnitTemplate {}) } else { Rc::new(DefaultTemplate {}) };
  let (merge, split) = get_semantics(&RuleNode::default(), template);
  Rule { lhs, rhs, merge, split, precedence: (0..n).collect(), tense: FxHashMap::default() }
}

// Logic for building a grammar from an AST.

type Grammar<T> = super::base::Grammar<Option<T>, T>;
type Lexer<T> = super::base::Lexer<Option<T>, T>;
type Rule<T> = super::base::Rule<Option<T>, T>;

type Merge<T> = super::base::Semantics<Fn(&[T]) -> T>;
type Split<T> = super::base::Semantics<Fn(&Option<T>) -> Vec<Vec<Option<T>>>>;

struct State<T: Payload> {
  binding: FxHashMap<String, Term>,
  grammar: Grammar<T>,
  macros: FxHashMap<String, Rc<MacroNode>>,
  symbol: FxHashMap<String, usize>,
}

impl<T: Payload> State<T> {
  fn build_binding(&mut self, binding: &str) -> Result<Term> {
    match self.binding.get(binding) {
      Some(Term::Symbol(x)) => Ok(Term::Symbol(*x)),
      Some(Term::Terminal(x)) => Ok(Term::Terminal(x.clone())),
      None => Err(format!("Unbound macro argument: {}", binding)),
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
        return Err(format!("{} got {} arguments; expected: {}", name, terms.len(), m.args.len()));
      }
      let mut b: FxHashMap<_, _> = m.args.iter().zip(terms).map(|(x, y)| (x.clone(), y)).collect();
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
    Term::Terminal(name)
  }

  fn build_term(&mut self, item: &ItemNode) -> Result<Term> {
    let base = self.build_expr(&item.expr)?;
    return if item.optional { Ok(self.build_option(base)) } else { Ok(base) };
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

  fn process_lexer(&mut self, _x: String) -> Result<()> {
    // TODO(skishore): Figure out hos to build a lexer given a string in Rust.
    unimplemented!()
  }

  fn process_macro(&mut self, x: MacroNode) -> Result<()> {
    match self.macros.insert(x.name.clone(), Rc::new(x)) {
      Some(x) => Err(format!("Duplicate macro: {}", x.name)),
      None => Ok(()),
    }
  }

  fn process_rules(&mut self, lhs: &str, rules: &[RuleNode]) -> Result<()> {
    let lhs = self.get_symbol(&lhs);
    rules.iter().try_for_each(|y| {
      let rhs = y.rhs.iter().map(|z| self.build_term(z)).collect::<Result<Vec<_>>>()?;
      let precedence = get_precedence(&y.rhs);
      // TODO(skishore): Use the term indices, the slots, here.
      let template: Rc<Template<T>> = match &y.template {
        Some(x) => T::template(x)?.into(),
        None => Rc::new(DefaultTemplate {}),
      };
      let (merge, split) = get_semantics(y, template);
      self.grammar.rules.push(Rule { lhs, rhs, merge, split, precedence, tense: y.tense.clone() });
      Ok(())
    })
  }

  fn process_start(&mut self, x: &str) {
    let lhs = self.get_symbol(x);
    self.grammar.rules.push(get_rule(0, vec![Term::Symbol(lhs)]));
  }
}

pub fn compile<T: Payload>(input: &str, lexer: Box<Lexer<T>>) -> Result<Grammar<T>> {
  let (mut lexers, mut macros, mut symbol) = (vec![], vec![], vec![]);
  parse(input)?.into_iter().for_each(|x| match x {
    RootNode::Lexer(x) => lexers.push(x),
    RootNode::Macro(x) => macros.push(x),
    RootNode::Rules(x) => symbol.push(x),
  });
  if lexers.is_empty() {
    return Err("Unable to find lexer block!".to_string());
  }

  // TODO(skishore): We need to actually construct a lexer here.
  let mut state: State<T> = State {
    binding: FxHashMap::default(),
    grammar: Grammar {
      key: Box::new(|x| match x {
        Some(x) => format!("Some({})", x.stringify()),
        None => "None".to_string(),
      }),
      lexer: lexer,
      names: vec![],
      rules: vec![],
      start: 0,
    },
    macros: FxHashMap::default(),
    symbol: FxHashMap::default(),
  };

  state.get_symbol("$ROOT");
  lexers.into_iter().try_for_each(|x| state.process_lexer(x))?;
  macros.into_iter().try_for_each(|x| state.process_macro(x))?;
  symbol.iter().try_for_each(|x| state.process_rules(&x.lhs, &x.rules))?;
  symbol.iter().filter(|x| x.root).for_each(|x| state.process_start(&x.lhs));
  Ok(state.grammar)
}

// A parser that builds up the AST above.

fn parse(input: &str) -> Result<Vec<RootNode>> {
  use lib::combine::*;
  use std::thread_local;

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
        map(&symbol, |x| TermNode::Symbol(x)),
        map(&id, |x| TermNode::Terminal(x)),
        map(terminal, |x| TermNode::Terminal(x)),
      ]);
      let (cell, expr) = lazy();
      cell.replace(any(&[
        map(&binding, |x| ExprNode::Binding(x)),
        seq4((&id, st("["), separate(&expr, &commas, 1), st("]")), |x| ExprNode::Macro(x.0, x.2)),
        map(term, |x| ExprNode::Term(x)),
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
        regexp(r#"lexer: ```[\s\S]*```"#, |x| RootNode::Lexer(x.to_string())),
        seq4((&id, args, &ws, &rule), |x| RootNode::Macro(MacroNode { name: x.0, args: x.1, rules: x.3 })),
        seq4((&symbol, opt(st("!")), &ws, &rule), |x| RootNode::Rules(SymbolNode { lhs: x.0, root: x.1.is_some(), rules: x.3 })),
      ]);
      seq3((&ws, separate(update, &ws, 1), &ws), |x| x.1)
    };
  }

  PARSER.with(|x| x.parse(input))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn smoke_test() {
    let input = r#"
# TODO(skishore): Deal with count semantics correctly. Right now we are not
# drawing a semantic distinction between singulars and plurals, but as a
# result text-generation can be strange. However, if we have to create a new
# "$NounType -> %noun_singular | %noun_plural" rule for each type, it will
# interact badly with the already redundant problem above.
#
# TODO(skishore): Deal with relations. On their own, "larka" has the semantics
# of a "boy", but "mera larka" means "my son", not "my boy". We can add
# relation words to the noun table, but we need to make sure they don't get
# expanded by %noun, only by %relation.
#
# TODO(skishore): Support parsing text with punctuation. That will also be
# useful for lists, as well as helping with, e.g. the ? at the end of AskName.
# We can use the existing fault-tolerance, along with support for explicit
# punctuation text terms.
#
# TODO(skishore): Create a way to pass hints to the lexer, like the gender of
# "I" and of "you", the tone, and the current pronoun categories in scope.
# This step is probably relatively easy, as long as we can define the API.

# Top-level intents.

$AskFood! (= 'Ask(R[want].$0)')
= YOU[$Person]:0^ kya $Khana? chahte^ hain^
= YOU[$Person]:0^ kya $Leenge^
= YOU[$PersonKo]:0 kya $Khana? chahie
= YOU[$PersonKo]:0 $Main?^ kya $La sakta^ hun^ (> -1)
= $Main?^ YOU[$PersonKo]:0 kya $La sakta^ hun^ (> -1)

$AskName! (= 'Ask(R[name].$0)')
= $Person^ kaun hai^
= $PersonKa^ nam* kya hai^

$Hello! (= 'Hello()')
= hello
= namaste

$Mention! (= 'Mention($0)')
= $Noun (< -10)

$TellName! (= 'Tell($0, name.$1)')
= $Person:0^ %token:1 hai^ (< -10)
= $PersonKa:0^ nam* %token:1 hai^ (< -10)

$TellWant! (= 'Tell($0, want.$1)')
= I[$Person]^ $Noun $WantActive^
= I[$Person]^ $Drink piega^
= I[$Person]^ $Food khaega^
= I[$PersonKo] $Noun^ $WantPassive^
= I[$PersonKo] $Drink^ pina hai^
= I[$PersonKo] $Food^ khana hai^

# Noun-phrase helpers.

$Adjectives (= '$0 & $1')
= $Adjectives? %adjective

$Determiner
= $NounKa (= 'owner.$0')
= %determiner (= 'context.$0')

$Relation
= $PersonKa^ baccha* (= 'parent.$0')
= $PersonKa^ larka* (= 'gender.male & parent.$0')
= $PersonKa^ larki* (= 'gender.female & parent.$0')

LIST[@item]
= @item (= '$0')
= @item aur^ @item (= '$0 | $2') (? count plural) (? person third)

NOUN[@term] (= '$0 & count.$1 & $2 & $3')
= $Determiner?^ %number?* $Adjectives?^ @term*

NOUN_OR_RELATION[@term] (= '$0')
= NOUN[@term]
= $Relation (< 2)

I[@person]
= @person (= '$0')
= NONE (= 'I') (? person first)

YOU[@person]
= @person (= '$0')
= NONE (= 'you') (? person second)

# Specific subtypes of noun phrase.

$Drink (= '$0')
= LIST[NOUN[%drink]]

$Food (= '$0')
= LIST[NOUN[%food]]

$Noun (= '$0')
= LIST[NOUN[%noun]]
= %direct

$NounKa (= '$0')
= NOUN_OR_RELATION[%noun] ka^
= %genitive
< %direct ka^ (< -0.5)

$Person (= '$0')
= LIST[NOUN_OR_RELATION[%person]]
= %direct

$PersonKa (= '$0')
= LIST[NOUN_OR_RELATION[%person]] ka^
= %genitive
< %direct ka^ (< -0.5)

$PersonKo (= '$0')
= LIST[NOUN_OR_RELATION[%person]] ko^
= %dative
< %direct ko^ (< -0.5)

# Simple substitutions.

$Khana
= khana
= khane ke liye

$Leenge
= khaenge
= leenge
= pienge

$La
= de
= la
= madad kar

$Main
= $MainSingular
= $MainPlural

$MainSingular
= main
< mujhe

$MainPlural
= ham
< hame

$WantActive
= leega
< khaega (< -0.5)
< piega (< -0.5)

$WantPassive
= chahie
= de do
= dijie
= do
< khana hai^ (< -0.5)
< pina hai^ (< -0.5)

# The base vocabulary, including several classes of words.

lexer: ```

const {flatten} = require('../lib/base');
const {HindiLexer} = require('../hindi/lexer');
const {Vocabulary} = require('../hindi/vocabulary');
const {Lambda} = require('../template/lambda');

const {adjectives, nouns, numbers, particles, pronouns, verbs} = Vocabulary;

const vocabulary = flatten([
  adjectives(`
            meaning | word
    ----------------|-------------
        quality.bad | kharab/KarAb
       quality.good | accha/acCA
       quality.okay | thik/TIk
         size.large | bara/baDZA
         size.small | chota/cotA
  `),
  nouns(`
    # The "role" column encodes gender and declension. Nouns with a "." do not
    # decline while nouns with an "s" decline in the plural and oblique cases.

      category | meaning                    | word          | role
      ---------|----------------------------|---------------|-----
      abstract | type.help                  | madad/maxax   | f.
             ^ | type.name                  | nam/nAm       | m.
         drink | type.tea                   | chai/cAy      | f.
             ^ | type.water                 | pani/pAnI     | m.
          food | type.apple                 | seb/seb       | m.
             ^ | type.bread                 | roti/rotI     | m.
             ^ | type.food                  | khana/KAnA    | m.
        person | type.child                 | baccha/baccA  | ms
             ^ | type.adult                 | log/log       | m.
             ^ | gender.male & type.child   | larka/ladZakA | ms
             ^ | gender.female & type.child | larki/ladZakI | fs
             ^ | gender.male & type.adult   | admi/AxmI     | m.
             ^ | gender.female & type.adult | aurat/Oraw    | fs
    profession | profession.doctor          | daktar/dAktar | m.
             ^ | profession.lawyer          | vakil/vakIl   | m.
  `),
  numbers(`
    meaning | word
    --------|-------------
          1 | ek/ek
          2 | do/xo
          3 | tin/wIn
          4 | char/cAr
          5 | panch/pAzc
          6 | chah/Cah
          7 | sat/sAw
          8 | ath/AT
          9 | nau/nO
  `),
  particles(`
    # TODO(skishore): The "temporary" category here contains words that should
    # appear in some part-of-speech list, but for which we don't yet have the
    # proper declension. For example, we haven't implemented the reflective
    # tense "chahie" for "chahna" or the command tense "dijie" for "dena".

      category | meaning | word            | declines
    -----------|---------|-----------------|---------
    determiner |    that | voh/vah         | n
             ^ |    this | yeh/yah         | n
      particle |       - | aur/Or          | n
             ^ |       - | hello/helo      | n
             ^ |       - | ka/kA           | y
             ^ |       - | ko/ko           | n
             ^ |       - | liye/liye       | n
             ^ |       - | namaste/namaswe | n
             ^ |       - | sakta/sakwA     | y
      question |     how | kaisa/kEsA      | y
             ^ |    what | kya/kyA         | n
             ^ |    when | kab/kab         | n
             ^ |   where | kaha/kahA       | n
             ^ |     who | kaun/kOn        | n
             ^ |     why | kyun/kyUM       | n
     temporary |       - | chahie/cAhIe    | n
             ^ |       - | dijie/dijIe     | n
  `),
  pronouns(`
    # The "role" column encodes person, number, and, for the 2nd person, tone.
    # The tone is either i (intimate), c (casual), or f (formal).

    role | direct   | genitive        | dative (1)   | dative (2)  | copula
    -----|----------|-----------------|--------------|-------------|---------
     1s. | main/mEM | mera/merA       | mujhko/muJko | mujhe/muJe  | hun/hUz
     2si | tu/wU    | tera/werA       | tujhko/wuJko | tujhe/wuJe  | hai/hE
     3s. | voh/vah  | uska/uskA       | usko/usko    | use/use     | ^
     1p. | ham/ham  | hamara/hamArA   | hamko/hamko  | hame/hame   | hain/hEM
     2pc | tum/wum  | tumhara/wumhArA | tumko/wumko  | tumhe/wumhe | ho/ho
     2pf | ap/Ap    | apka/ApkA       | apko/Apko    | <           | ^
     3p. | voh/vah  | uska/uskA       | unko/unko    | usne/usne   | hai/hE
  `),
  verbs(`
    meaning | word
    --------|-------------
      bring | lana/lAnA
         do | karna/karnA
      drink | pina/pInA
        eat | khana/KAnA
       give | dena/xenA
      sleep | sona/sonA
       take | lena/lenA
       want | chahna/cAhnA
  `),
]);

return new HindiLexer(Lambda, vocabulary);

```
"#;
    parse(input).unwrap();
  }
}
