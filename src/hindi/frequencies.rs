use super::super::lib::base::HashMap;

pub type Bytes = &'static [u8];

thread_local! {
  pub static VOWEL_SKIP_LOG_FREQUENCY: f32 = (0.1 as f32).log2();

  pub static LOG_FREQUENCY: HashMap<Bytes, (Bytes, HashMap<Bytes, f32>)> = {
    let mut result = HashMap::default();
    result.insert("a", items(&[("a", 10), ("e", 0), ("i", 0), ("o", 0), ("u", 0), ("aa", 5), ("", 0)]));
    result.insert("A", items(&[("aa", 14730), ("a", 13216), ("", 0)]));
    result.insert("i", items(&[("a", 36), ("e", 75), ("i", 8784), ("o", 0), ("u", 4), ("ee", 94), ("", 0)]));
    result.insert("I", items(&[("ee", 1369), ("i", 8438), ("", 0)]));
    result.insert("u", items(&[("a", 6), ("e", 0), ("i", 4), ("o", 22), ("u", 6241), ("oo", 73), ("", 0)]));
    result.insert("U", items(&[("oo", 1000), ("u", 1294), ("", 0)]));
    result.insert("ऋ", items(&[("ri", 80), ("", 0)]));
    result.insert("ऌ", items(&[("li", 0), ("", 0)]));
    result.insert("ऍ", items(&[("e", 0), ("", 0)]));
    result.insert("e", items(&[("a", 75), ("e", 14356), ("i", 37), ("o", 27), ("u", 0), ("ai", 28), ("", 0)]));
    result.insert("E", items(&[("ai", 1754), ("e", 25), ("a", 83), ("", 0)]));
    result.insert("ऑ", items(&[("o", 3), ("", 0)]));
    result.insert("o", items(&[("a", 2), ("e", 6), ("i", 1), ("o", 6321), ("u", 4), ("au", 2), ("", 0)]));
    result.insert("O", items(&[("au", 560), ("aw", 1), ("ou", 36), ("ow", 18), ("o", 93), ("", 0)]));
    result.insert("ॠ", items(&[("ru", 0)]));
    result.insert("ॡ", items(&[("lu", 0)]));
    result.insert("k", items(&[("k", 10440), ("kh", 49)]));
    result.insert("K", items(&[("kh", 1793), ("k", 58)]));
    result.insert("g", items(&[("g", 5565), ("gh", 68)]));
    result.insert("G", items(&[("gh", 338), ("g", 30)]));
    result.insert("f", items(&[("n", 0)]));
    result.insert("c", items(&[("ch", 2463), ("c", 36)]));
    result.insert("C", items(&[("ch", 359), ("chh", 634)]));
    result.insert("j", items(&[("j", 3580), ("jh", 14), ("z", 225)]));
    result.insert("J", items(&[("jh", 755), ("j", 78)]));
    result.insert("F", items(&[("n", 0)]));
    result.insert("t", items(&[("t", 1344), ("th", 12)]));
    result.insert("T", items(&[("th", 389), ("t", 48)]));
    result.insert("d", items(&[("d", 563), ("dh", 13)]));
    result.insert("D", items(&[("dh", 83), ("d", 17)]));
    result.insert("N", items(&[("n", 305)]));
    result.insert("w", items(&[("t", 7596), ("th", 234)]));
    result.insert("W", items(&[("th", 573), ("t", 16)]));
    result.insert("x", items(&[("d", 4856), ("dh", 72)]));
    result.insert("X", items(&[("dh", 986), ("d", 35)]));
    result.insert("n", items(&[("n", 10291)]));
    result.insert("p", items(&[("p", 4714), ("ph", 7)]));
    result.insert("P", items(&[("ph", 154), ("f", 219), ("p", 5)]));
    result.insert("b", items(&[("b", 5414), ("bh", 69)]));
    result.insert("B", items(&[("bh", 1423), ("b", 37)]));
    result.insert("m", items(&[("m", 8291)]));
    result.insert("y", items(&[("y", 5296)]));
    result.insert("r", items(&[("r", 13713)]));
    result.insert("l", items(&[("l", 7891)]));
    result.insert("v", items(&[("v", 2647), ("w", 1403)]));
    result.insert("S", items(&[("sh", 1597), ("s", 145)]));
    result.insert("R", items(&[("sh", 414), ("s", 23)]));
    result.insert("s", items(&[("s", 7826), ("sh", 28)]));
    result.insert("h", items(&[("h", 7537)]));
    result.insert("ळ", items(&[("l", 0)]));
    result.insert("ऴ", items(&[("l", 0)]));
    result.insert("kZ", items(&[("k", 20), ("kh", 0)]));
    result.insert("KZ", items(&[("kh", 86), ("k", 115)]));
    result.insert("gZ", items(&[("g", 111), ("gh", 24)]));
    result.insert("jZ", items(&[("z", 877), ("j", 70)]));
    result.insert("dZ", items(&[("r", 46), ("d", 1196)]));
    result.insert("DZ", items(&[("rh", 5), ("dh", 152), ("r", 0), ("d", 33)]));
    result.insert("nZ", items(&[("n", 0)]));
    result.insert("pZ", items(&[("f", 466), ("ph", 1), ("p", 0)]));
    result.insert("yZ", items(&[("y", 2)]));
    result.insert("rZ", items(&[("r", 0)]));
    result.insert("ax", items(&[("a", 26067), ("e", 856), ("i", 48), ("o", 60), ("u", 207), ("", 5287)]));
    result.insert("ay", items(&[("a", 927), ("e", 173), ("i", 33), ("o", 38), ("u", 6), ("", 13369)]));
    result.insert("nx", items(&[("n", 3839), ("m", 44), ("", 297)]));
    result.insert("ny", items(&[("n", 4145), ("m", 23), ("in", 948), ("ih", 54), ("", 1621)]));
    result.insert("yx", items(&[("y", 1428), ("", 1877)]));
    result.insert("zy", items(&[("h", 151), ("n", 298), ("in", 9), ("ih", 0), ("", 42241)]));
    pair_keys_with_values(result)
  };
}

pub fn pair_keys_with_values(
  dict: HashMap<&'static str, HashMap<Bytes, f32>>,
) -> HashMap<Bytes, (Bytes, HashMap<Bytes, f32>)> {
  dict.into_iter().map(|(k, v)| (k.as_bytes(), (k.as_bytes(), v))).collect()
}

pub fn items(items: &[(&'static str, usize)]) -> HashMap<Bytes, f32> {
  let sum: f32 = items.iter().map(|(_, v)| *v as f32 + 1.0).sum();
  items.iter().map(|(k, v)| (k.as_bytes(), ((*v as f32 + 1.0) / sum).log2())).collect()
}
