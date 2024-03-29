#![allow(dead_code)]
#![feature(test)]

extern crate rand;
extern crate regex;
extern crate rustc_hash;

#[cfg(test)]
extern crate test;

#[macro_use]
mod lib;
mod hindi;
mod nlu;
mod payload;

use hindi::lexer::HindiLexer;
use lib::base::Result;
use nlu::base::{Grammar, Match};
use nlu::corrector::{Corrector, Diff};
use nlu::fantasy::compile;
use nlu::generator::Generator;
use nlu::parser::Parser;
use payload::base::Payload;
use payload::lambda::Lambda;
use std::fs::read_to_string;
use std::rc::Rc;
use std::time::SystemTime;

fn render<T>(matches: &[Rc<Match<T>>]) -> String {
  let texts = matches.iter().map(|x| x.texts.get("latin").map(|y| y.as_str()).unwrap_or("?"));
  texts.collect::<Vec<_>>().join(" ")
}

fn main() -> Result<()> {
  let args: Vec<_> = std::env::args().collect();
  if args.len() != 4 || !(args[2] == "generate" || args[2] == "parse") {
    Err("Usage: ./main $gramar [generate|parse] $input")?;
  }
  let (file, generate, input) = (&args[1], args[2] == "generate", &args[3]);
  let data = read_to_string(file).map_err(|x| format!("Failed to read file {}: {}", file, x))?;
  let grammar = compile(&data, HindiLexer::new)
    .map_err(|x| format!("Failed to compile grammar: {}\n\n{:?}", file, x))?;

  let time = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs();
  println!("Using seed: {}", time);
  let mut rng = rand::SeedableRng::seed_from_u64(time);

  let tree = if generate {
    let generator = Generator::new(&grammar);
    let maybe = generator.generate(&mut rng, &Some(Lambda::parse(input)?));
    maybe.ok_or_else(|| format!("Failed to generate output: {:?}", input))?
  } else {
    let maybe = Parser::new(&grammar).set_debug(true).parse(input);
    maybe.ok_or_else(|| format!("Failed to parse input: {:?}", input))?
  };

  println!("Old value repr: {}", tree.value.repr());
  println!("Old Latin text: {}", render(&tree.matches()));
  let correction = Corrector::new(&grammar).correct(&mut rng, &tree);
  println!("New Latin text: {}", render(&correction.tree.matches()));
  for diff in correction.diff {
    if let Diff::Wrong(x) = diff {
      println!("Corrected {} -> {}:", render(&x.old_matches), render(&x.new_matches));
      x.errors.iter().for_each(|y| println!("- {}", y));
    }
  }
  Ok(())
}

fn make_grammar() -> Result<Grammar<Option<Lambda>, Lambda>> {
  let data = r#"
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
= $PersonKa^ nam* kya hai^ (? count singular)

$Hello! (= 'Hello()')
= hello
= namaste

$Mention! (= 'Mention($0)')
= $Noun (< -10)

$TellName! (= 'Tell($0, name.$1)')
= $Person:0^ %token:1 hai^ (< -10)
= $PersonKa:0^ nam* %token:1 hai^ (< -10) (? count singular)

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

  $ADJECTIVES:

         meaning | word
    -------------|-------------
     quality.bad | kharab/KarAb
    quality.good | accha/acCA
    quality.okay | thik/TIk
      size.large | bara/baDZA
      size.small | chota/cotA

  $NOUNS:

    # The "role" column encodes gender and declension. Nouns with a "." do not
    # decline while nouns with an "s" decline in the plural and oblique cases.

      category | meaning                    | word          | role
    -----------|----------------------------|---------------|-----
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

  $NOUN_PLURALS:

      singular | plural
    -----------|-----------
    aurat/Oraw | aurte/Orwe

  $NUMBERS:

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

  $PARTICLES:

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

  $PRONOUNS:

    # The "role" column encodes person, number, and, for the 2nd person, tone.
    # The tone is either i (intimate), c (casual), or f (formal).

    role | direct   | genitive        | dative_1     | dative_2    | copula
    -----|----------|-----------------|--------------|-------------|---------
     1s. | main/mEM | mera/merA       | mujhko/muJko | mujhe/muJe  | hun/hUz
     2si | tu/wU    | tera/werA       | tujhko/wuJko | tujhe/wuJe  | hai/hE
     3s. | voh/vah  | uska/uskA       | usko/usko    | use/use     | ^
     1p. | ham/ham  | hamara/hamArA   | hamko/hamko  | hame/hame   | hain/hEM
     2pc | tum/wum  | tumhara/wumhArA | tumko/wumko  | tumhe/wumhe | ho/ho
     2pf | ap/Ap    | apka/ApkA       | apko/Apko    | <           | ^
     3p. | voh/vah  | uska/uskA       | unko/unko    | usne/usne   | hai/hE

  $VERBS:

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

```"#;
  let grammar = compile(data, HindiLexer::new);
  Ok(grammar.map_err(|x| format!("Failed to compile grammar:\n\n{:?}", x))?)
}

#[no_mangle]
pub extern "C" fn correction_benchmark(i: f64) -> f64 {
  let grammar = make_grammar().unwrap();
  let tree = Parser::new(&grammar).parse("do accha acche larki ko pani chahie").unwrap();
  let mut rng = rand::SeedableRng::from_seed([17; 32]);
  let corrector = Corrector::new(&grammar);
  for _ in 0..(i as u64) {
    corrector.correct(&mut rng, &tree);
  }
  0.0
}

#[no_mangle]
pub extern "C" fn generation_benchmark(i: f64) -> f64 {
  let grammar = make_grammar().unwrap();
  let generator = Generator::new(&grammar);
  let mut rng = rand::SeedableRng::from_seed([17; 32]);
  let semantics = Some(Lambda::parse("Tell(owner.I & type.child, want.type.water)").unwrap());
  for _ in 0..(i as u64) {
    generator.generate(&mut rng, &semantics).unwrap();
  }
  0.0
}

#[no_mangle]
pub extern "C" fn parsing_benchmark(i: f64) -> f64 {
  let grammar = make_grammar().unwrap();
  let parser = Parser::new(&grammar);
  for _ in 0..(i as u64) {
    parser.parse("meri bacche ko pani chahie").unwrap();
  }
  0.0
}
