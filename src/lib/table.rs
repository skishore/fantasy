use super::base::Result;

#[macro_export]
macro_rules! for_each_row {
  ($a:expr, [$($b:ident),+], $c:block) => {
    let helper = super::super::lib::table::parse_rows;
    for ($($b),*) in helper(&[$(stringify!($b)),*], $a)?.into_iter().map(|x| {
      match &x.as_slice() { &[$($b),*] => ($(*$b),*), _ => panic!() }
    }) $c
  }
}

#[macro_export]
macro_rules! for_each_table {
  ($a:expr, [$($b:ident),+], $c:block) => {
    let helper = super::super::lib::table::parse_tables;
    match &helper(&[$(stringify!($b)),*], $a)?.as_slice() {
      &[$($b),*] => $c, _ => panic!()
    }
  }
}

pub fn parse_rows<'a>(columns: &[&str], table: &'a str) -> Result<Vec<Vec<&'a str>>> {
  let lines: Vec<_> = table.split('\n').map(|x| x.trim()).collect();
  let valid: Vec<_> = lines.into_iter().filter(|x| !(x.is_empty() || x.starts_with('#'))).collect();
  if valid.len() < 3 {
    Err(format!("Invalid table. Tables must have at least one row:\n{}", table))?
  }
  let (mut prev, mut result) = (vec![], vec![]);
  let actual: Vec<_> = valid[0].split('|').map(|x| x.trim()).collect();
  if actual != columns {
    let (actual, columns) = (actual.join(", "), columns.join(", "));
    Err(format!("Invalid table. Got columns: {}; expected: {}:\n{}", actual, columns, table))?
  }
  let n = columns.len();
  for (i, row) in valid[2..].iter().enumerate() {
    let mut next: Vec<_> = row.split('|').map(|x| x.trim()).collect();
    if next.len() != n {
      Err(format!("Invalid row {}: got {} fields; expected: {}\n{}", i + 1, next.len(), n, table))?;
    }
    for j in 0..next.len() {
      let mut cell = Some(next[j]);
      if next[j] == "<" {
        cell = if j == 0 { None } else { Some(next[j - 1]) };
      } else if next[j] == "^" {
        cell = if i == 0 { None } else { Some(prev[j]) };
      }
      next[j] = cell.ok_or(format!("Invalid cell row {}, column {}:\n{}", i + 1, j + 1, table))?;
    }
    result.push(next.clone());
    prev = next;
  }
  Ok(result)
}

pub fn parse_tables<'a>(names: &[&str], text: &'a str) -> Result<Vec<&'a str>> {
  let blocks: Vec<_> = text.split('$').map(|x| x.trim()).collect();
  if blocks.is_empty() || !blocks[0].is_empty() {
    Err(format!("Invalid table list: no $ found!\n{}", text))?
  }
  let (mut actual, mut result) = (vec![], vec![]);
  for block in blocks.iter().skip(1) {
    let first = block.split('\n').next().unwrap().trim();
    let index = first.find(':').ok_or_else(|| format!("Block must start with NAME: {}", first))?;
    actual.push(block[..index].to_lowercase());
    result.push(&block[index + 1..]);
  }
  if actual != names {
    let (actual, names) = (actual.join(", "), names.join(", "));
    Err(format!("Invalid tables. Got columns: {}; expected: {}", actual, names))?
  }
  Ok(result)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn test_error<T: std::fmt::Debug>(result: Result<T>, prefix: &str) {
    let error = format!("{:?}", result.unwrap_err());
    if !error.starts_with(prefix) {
      let error = error.split('\n').next().unwrap_or("");
      panic!("Error does not match prefix:\nexpected: {:?}\n  actual: {:?}", prefix, error);
    }
  }

  #[test]
  fn test_valid_table() {
    let table = "
      # Check that top-level comments are ignored.

      key | value
      ----|------
       k1 | v1
        ^ | <
        ^ | v2
       k2 | <
    ";
    assert_eq!(
      parse_rows(&["key", "value"], table).unwrap(),
      [["k1", "v1"], ["k1", "k1"], ["k1", "v2"], ["k2", "k2"]],
    );
  }

  #[test]
  fn test_empty_table() {
    let table = "
      key | value | extra
      ----|-------|------
      #k1 | ^     | <
    ";
    test_error(
      parse_rows(&["key", "value", "extra"], table),
      "Invalid table. Tables must have at least one row:",
    );
  }

  #[test]
  fn test_incorrect_columns() {
    let table = "
      key | value | extra
      ----|-------|------
       k1 | v1
    ";
    test_error(
      parse_rows(&["key", "extra", "value"], table),
      "Invalid table. Got columns: key, value, extra; expected: key, extra, value:",
    );
  }

  #[test]
  fn test_incorrect_number_of_columns() {
    let table = "
      key | value | extra
      ----|-------|------
       k1 | v1
    ";
    test_error(
      parse_rows(&["key", "value", "extra"], table),
      "Invalid row 1: got 2 fields; expected: 3",
    );
  }

  #[test]
  fn test_invalid_redirect() {
    let table = "
      key | value | extra
      ----|-------|------
       k1 | ^     | <
    ";
    test_error(parse_rows(&["key", "value", "extra"], table), "Invalid cell row 1, column 2:");
  }
}
