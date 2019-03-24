use super::super::lib::base::{HashMap, Result};
use super::super::nlu::base::Tense;

pub struct Entry {
  pub head: String,
  pub hindi: String,
  pub latin: String,
  pub scores: HashMap<String, f32>,
  pub tenses: Vec<Tense>,
  pub value: String,
}

pub fn numbers(table: &str) -> Result<Vec<Entry>> {
  for_each_row!(table, [meaning, word], {
    println!("{{meaning: {}, word: {}}}", meaning, word);
  });
  Ok(vec![])
}
