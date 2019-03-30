use super::super::lib::base::{HashMap, Result};
use super::super::nlu::base::Tense;
use super::wx::wx_to_hindi;
use std::iter::once;

pub struct Entry {
  pub head: String,
  pub hindi: String,
  pub latin: String,
  pub scores: HashMap<String, f32>,
  pub tenses: Vec<Tense>,
  pub value: String,
}

thread_local! {
  static CATEGORIES: Vec<(&'static str, Vec<(u8, &'static str)>)> = vec![
    ("count", vec![(b'p', "plural"), (b's', "singular")]),
    ("gender", vec![(b'f', "female"), (b'm', "male")]),
    ("person", vec![(b'1', "first"), (b'2', "second"), (b'3', "third")]),
    ("time", vec![(b'<', "past"), (b'=', "present"), (b'>', "future")]),
    ("tone", vec![(b'c', "casual"), (b'f', "formal"), (b'i', "intimate")]),
  ];
}

// Some helpers. Call rollup to construct a list of related vocabulary result. Call tense
// to build a Tense object with interned (statically-allocated) string keys and values.

struct Case {
  hindi: String,
  latin: String,
  tense: Tense,
}

fn rollup(cases: &[Case], class: &str, value: &str) -> Result<Vec<Entry>> {
  assert!(!cases.is_empty());
  let head = format!("{}-{}", class, cases[0].hindi);
  let mut result: Vec<Entry> = vec![];

  for case in cases {
    if result.iter().any(|x| x.hindi == case.hindi) {
      continue;
    }
    wx_to_hindi(&case.hindi)?;
    let (hindi, latin) = (case.hindi.clone(), case.latin.clone());
    let scores = std::iter::once((format!("%{}", class), 0.0))
      .chain(cases.iter().map(|x| (x.latin.clone(), if x.hindi == hindi { 0.0 } else { -1.0 })))
      .collect();
    let tenses = cases.iter().filter(|x| x.hindi == hindi).map(|x| x.tense.clone()).collect();
    result.push(Entry { head: head.clone(), hindi, latin, scores, tenses, value: value.into() });
  }
  Ok(result)
}

fn split(word: &str) -> Result<(String, String)> {
  let index = word.find('/').ok_or_else(|| format!("Invalid word (missing slash): {}", word))?;
  let (hindi, latin) = (&word[index + 1..], &word[..index]);
  Ok((hindi.to_string(), latin.to_string()))
}

fn tense(code: &str) -> Result<Tense> {
  CATEGORIES.with(|categories| {
    if code.len() != categories.len() {
      Err(format!("Invalid tense code: {}", code))?
    }
    let mut result = Tense::default();
    for (i, ch) in code.as_bytes().iter().cloned().enumerate().filter(|x| x.1 != b'.') {
      let (category, values) = &categories[i];
      let maybe = values.iter().filter(|x| x.0 == ch).next();
      let value = maybe.ok_or_else(|| format!("Invalid tense code: {}", code))?;
      result.insert(category, value.1);
    }
    Ok(result)
  })
}

fn zip(hindis: Vec<String>, latins: Vec<String>, tenses: Vec<Tense>) -> Vec<Case> {
  assert!(hindis.len() == latins.len() && latins.len() == tenses.len());
  let iter = hindis.into_iter().zip(latins.into_iter()).zip(tenses.into_iter());
  iter.map(|x| Case { hindi: (x.0).0, latin: (x.0).1, tense: x.1 }).collect()
}

// Our public interface is a series of functions that can be used to build vocabulary result.

pub fn adjectives(table: &str) -> Result<Vec<Entry>> {
  let mut result = vec![];
  for_each_row!(table, [meaning, word], {
    let (hindi, latin) = split(word)?;
    if hindi.ends_with('A') && latin.ends_with('a') {
      let (hstem, lstem) = (&hindi[..hindi.len() - 1], &latin[..latin.len() - 1]);
      let hindis: Vec<_> = ['A', 'e', 'I'].iter().map(|x| format!("{}{}", hstem, x)).collect();
      let latins: Vec<_> = ['a', 'e', 'i'].iter().map(|x| format!("{}{}", lstem, x)).collect();
      let tenses: Vec<_> = ["sm...", "pm...", ".f..."].iter().map(|x| tense(x).unwrap()).collect();
      result.push(rollup(&zip(hindis, latins, tenses), "adjective", meaning)?);
    } else {
      result.push(rollup(&[Case { hindi, latin, tense: Tense::default() }], "adjective", meaning)?);
    }
  });
  Ok(result.into_iter().flatten().collect())
}

pub fn nouns(main: &str, supplement: &str) -> Result<Vec<Entry>> {
  let mut plurals = HashMap::default();
  for_each_row!(supplement, [singular, plural], {
    plurals.insert(singular, plural);
  });
  let mut result = vec![];
  for_each_row!(main, [category, meaning, word, role], {
    let (hindi, latin) = split(word)?;
    let (gender, declines) = match role {
      "m." => ('m', false),
      "f." => ('f', false),
      "ms" => ('m', true),
      "fs" => ('f', true),
      _ => Err(format!("Invalid noun role: {}", role))?,
    };

    // Create singular and plural forms for nouns that decline.
    if declines {
      let (hp, lp) = plurals.remove(word).map(|x| split(x)).unwrap_or_else(|| {
        if gender == 'm' && hindi.ends_with('A') && latin.ends_with('a') {
          let (hstem, lstem) = (&hindi[..hindi.len() - 1], &latin[..latin.len() - 1]);
          return Ok((format!("{}e", hstem), format!("{}e", lstem)));
        } else if gender == 'f' && hindi.ends_with('I') && latin.ends_with('i') {
          return Ok((format!("{}yAM", hindi), format!("{}ya", latin)));
        }
        Err(format!("Unable to pluralize noun: {}", word))?
      })?;
      let tenses = vec![tense(&format!("s{}3..", gender))?, tense(&format!("p{}3..", gender))?];
      result.push(rollup(&zip(vec![hindi, hp], vec![latin, lp], tenses), "noun", meaning)?);
    } else {
      let tense = tense(&format!(".{}3..", gender))?;
      result.push(rollup(&[Case { hindi, latin, tense }], "noun", meaning)?);
    }

    // Add types to each entry based on the category and the count.
    let last = result.last_mut().unwrap();
    last.iter_mut().for_each(|x| {
      x.scores.insert(format!("%{}", category), 0.0);
      let counts: Vec<_> = x.tenses.iter().filter_map(|y| y.get("count").cloned()).collect();
      let nonempty = if counts.is_empty() { vec!["singular", "plural"] } else { counts };
      nonempty.iter().for_each(|y| {
        x.scores.insert(format!("%noun_{}", y), 0.0);
        x.scores.insert(format!("%{}_{}", category, y), 0.0);
      });
    });
  });

  if !plurals.is_empty() {
    let unused: Vec<_> = plurals.into_iter().map(|x| x.0.to_string()).collect();
    Err(format!("Unused plural nouns: {}", unused.join(", ")))?
  }
  Ok(result.into_iter().flatten().collect())
}

pub fn numbers(table: &str) -> Result<Vec<Entry>> {
  let mut result = vec![];
  for_each_row!(table, [meaning, word], {
    let value = meaning.parse::<usize>().map_err(|_| format!("Invalid number: {}", meaning))?;
    let (hindi, latin) = split(word)?;
    let tense = tense(if value == 1 { "s...." } else { "p...." }).unwrap();
    result.push(rollup(&[Case { hindi, latin, tense }], "number", meaning)?);
  });
  Ok(result.into_iter().flatten().collect())
}

pub fn particles(table: &str) -> Result<Vec<Entry>> {
  let mut result = vec![];
  for_each_row!(table, [category, meaning, word, declines], {
    let (hindi, latin) = split(word)?;
    let declines = match declines {
      "n" => false,
      "y" => true,
      _ => Err(format!("declines must be n or y; got: {}", declines))?,
    };

    // Create male singular, male plural, and female forms for particles that decline.
    if declines {
      if !(hindi.ends_with('A') && latin.ends_with('a')) {
        Err(format!("Declining particles must end in A. Got: {}", word))?
      }
      let (hstem, lstem) = (&hindi[..hindi.len() - 1], &latin[..latin.len() - 1]);
      let hindis: Vec<_> = ['A', 'e', 'I'].iter().map(|x| format!("{}{}", hstem, x)).collect();
      let latins: Vec<_> = ['a', 'e', 'i'].iter().map(|x| format!("{}{}", lstem, x)).collect();
      let tenses: Vec<_> = ["sm...", "pm...", ".f..."].iter().map(|x| tense(x).unwrap()).collect();
      result.push(rollup(&zip(hindis, latins, tenses), "particle", meaning)?);
    } else {
      result.push(rollup(&[Case { hindi, latin, tense: Tense::default() }], "particle", meaning)?);
    }

    // Add types to particles based on their category.
    let last = result.last_mut().unwrap();
    last.iter_mut().for_each(|x| std::mem::drop(x.scores.insert(format!("%{}", category), 0.0)));
  });
  Ok(result.into_iter().flatten().collect())
}

pub fn pronouns(table: &str) -> Result<Vec<Entry>> {
  let mut groups = HashMap::default();
  for_each_row!(table, [role, direct, genitive, dative_1, dative_2, copula], {
    if !(role.len() == 3 && role.is_ascii() && role.find(|c| '1' <= c && c <= '3') == Some(0)) {
      Err(format!("Invalid pronoun role: {}", role))?
    }
    let (person, count, tone) = (&role[..1], &role[1..2], &role[2..]);
    let basis = tense(&format!("{}.{}.{}", count, person, tone))?;
    let entry = (basis, copula, dative_1, dative_2, direct, genitive);
    groups.entry(person).or_insert(vec![]).push(entry);
  });
  let (mut copula_cases, mut result) = (vec![], vec![]);
  for (person, value) in &[("1", "I"), ("2", "you"), ("3", "they")] {
    for entry in groups.get(person).unwrap_or(&vec![]) {
      let (basis, copula, dative_1, dative_2, direct, genitive) = entry;
      copula_cases.push({
        let (hindi, latin) = split(copula)?;
        Case { hindi, latin, tense: basis.clone() }
      });
      let direct_cases = {
        let (hindi, latin) = split(direct)?;
        vec![Case { hindi, latin, tense: basis.clone() }]
      };
      let genitive_cases = {
        let (hindi, latin) = split(genitive)?;
        if !(hindi.ends_with('A') && latin.ends_with('a')) {
          Err(format!("Genitive pronouns must end in A. Got: {}", genitive))?
        }
        let (hstem, lstem) = (&hindi[..hindi.len() - 1], &latin[..latin.len() - 1]);
        let hindis: Vec<_> = ['A', 'e', 'I'].iter().map(|x| format!("{}{}", hstem, x)).collect();
        let latins: Vec<_> = ['a', 'e', 'i'].iter().map(|x| format!("{}{}", lstem, x)).collect();
        let ts: Vec<_> = ["sm...", "pm...", ".f..."].iter().map(|x| tense(x).unwrap()).collect();
        zip(hindis, latins, ts)
      };
      let dative_cases = {
        let datives = if dative_1 == dative_2 { vec![dative_1] } else { vec![dative_1, dative_2] };
        let splits = datives.into_iter().map(|x| split(x)).collect::<Result<Vec<_>>>()?;
        let hindis: Vec<_> = splits.iter().map(|x| x.0.to_string()).collect();
        let latins: Vec<_> = splits.iter().map(|x| x.1.to_string()).collect();
        let tenses: Vec<_> = splits.iter().map(|_| basis.clone()).collect();
        zip(hindis, latins, tenses)
      };
      result.push(rollup(&dative_cases, "dative", value)?);
      result.push(rollup(&direct_cases, "direct", value)?);
      result.push(rollup(&genitive_cases, "genitive", value)?);
    }
  }
  result.push(rollup(&copula_cases, "copula", "be")?);
  Ok(result.into_iter().flatten().collect())
}

pub fn verbs(table: &str) -> Result<Vec<Entry>> {
  // TODO(skishore): Add command forms here.
  // TODO(skishore): Handle "reversed" verbs like "chahna".
  // TODO(skishore): Handle irregular verbs here ("hona", "jana", etc.)
  let mut result = vec![];
  let base_forms = [("", "", "stem"), ("ne", "ne", "gerund"), ("nA", "na", "infinitive")];
  let time_forms = [("", "", "past", true), ("w", "t", "present", false)];
  for_each_row!(table, [meaning, word], {
    let (hindi, latin) = split(word)?;
    if !(hindi.ends_with('A') && latin.ends_with('a')) {
      Err(format!("Verbs must end in nA. Got: {}", word))?
    }
    let (hstem, lstem) = (&hindi[..hindi.len() - 2], &latin[..latin.len() - 2]);
    let vowel = "aeiou".chars().any(|x| hstem.to_lowercase().ends_with(x));

    // For each base type, add an entry for the verb.
    for (h, l, t) in &base_forms {
      let hindi = format!("{}{}", hstem, h);
      let latin = format!("{}{}", lstem, l);
      result.push(rollup(&[Case { hindi, latin, tense: Tense::default() }], "verb", meaning)?);
      let last = result.last_mut().unwrap();
      last.iter_mut().for_each(|x| std::mem::drop(x.scores.insert(format!("%verb_{}", t), 0.0)));
    }

    // For each temporal type, add declined entries for the verb.
    for (h, l, time, prefix) in &time_forms {
      let y = if vowel && *prefix { "y" } else { "" };
      let h: Vec<_> = ['A', 'e', 'I'].iter().map(|x| format!("{}{}{}{}", hstem, h, y, x)).collect();
      let l: Vec<_> = ['a', 'e', 'i'].iter().map(|x| format!("{}{}{}{}", lstem, l, y, x)).collect();
      let mut t: Vec<_> = ["sm...", "pm...", ".f..."].iter().map(|x| tense(x).unwrap()).collect();
      t.iter_mut().for_each(|x| std::mem::drop(x.insert("time", time)));
      result.push(rollup(&zip(h, l, t), "verb", meaning)?);
      let last = result.last_mut().unwrap();
      last.iter_mut().for_each(|x| std::mem::drop(x.scores.insert(format!("%verb_{}", time), 0.0)));
    }

    // The future tense is special: it has different forms based on person.
    for time in &["future"] {
      let (male, female) = (("gender", "male"), ("gender", "female"));
      let hs: Vec<_> = "UngA  egA   egA   enge  ogA   enge  enge".split_whitespace().collect();
      let ls: Vec<_> = "unga  ega   ega   enge  oga   enge  enge".split_whitespace().collect();
      let ts: Vec<_> = "s.1.. s.2.i s.3.. p.1.. p.2.c p.2.f p.3..".split_whitespace().collect();
      let hindis = hs.iter().map(|x| x.to_string());
      let hindis = hindis
        .chain(hs.iter().map(|x| format!("{}I", &x[..x.len() - 1])))
        .map(|x| format!("{}{}", hstem, x));
      let latins = ls.iter().map(|x| x.to_string());
      let latins = latins
        .chain(ls.iter().map(|x| format!("{}i", &x[..x.len() - 1])))
        .map(|x| format!("{}{}", lstem, x));
      let tenses = ts.iter().map(|x| tense(x)).collect::<Result<Vec<_>>>()?;
      let tenses = tenses
        .iter()
        .map(|x| x.clone().into_iter().chain(once(male)).collect())
        .chain(tenses.iter().map(|x| x.clone().into_iter().chain(once(female)).collect()))
        .collect();
      result.push(rollup(&zip(hindis.collect(), latins.collect(), tenses), "verb", meaning)?);
      let last = result.last_mut().unwrap();
      last.iter_mut().for_each(|x| std::mem::drop(x.scores.insert(format!("%verb_{}", time), 0.0)));
    }
  });
  Ok(result.into_iter().flatten().collect())
}

#[cfg(test)]
mod test {
  use super::*;

  #[test]
  fn test_all_vocabulary_entries() {
    let vocabulary = vec![
      adjectives("
             meaning | word
        -------------|-------------
         quality.bad | kharab/KarAb
        quality.good | accha/acCA
        quality.okay | thik/TIk
          size.large | bara/baDZA
          size.small | chota/cotA
      "),
      nouns(r#"
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
      "#, "
          singular | plural
        -----------|-----------
        aurat/Oraw | aurte/Orwe
      "),
      numbers("
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
      "),
      particles(r#"
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
      "#),
      pronouns(r#"
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
      "#),
      verbs("
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
      "),
    ];
    let _: Vec<_> = vocabulary.into_iter().flat_map(|x| x.unwrap().into_iter()).collect();
  }
}
