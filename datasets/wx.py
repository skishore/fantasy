# -*- coding: utf-8 -*-


def build_dict(keys, values):
    assert(len(keys) == len(values))
    return dict(zip(keys, values))


HINDI = u'अआइईउऊएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहऋॠऌ'
LATIN = u'aAiIuUeEoOkKgGfcCjJFtTdDNwWxXnpPbBmyrlvSRshqQL'

EXTRA = u'अंअःअँअ़'[1::2]
HINDI = HINDI + EXTRA
LATIN = LATIN + u'MHzZ'

CONVERSION = build_dict(LATIN, HINDI)
NUKTAS = build_dict(u'कखगजडढफ', u'क़ख़ग़ज़ड़ढ़फ़')

VOWELS = {
  u'अ': u'',
  u'आ': u'\u093E',
  u'इ': u'\u093F',
  u'ई': u'\u0940',
  u'उ': u'\u0941',
  u'ऊ': u'\u0942',
  u'ऋ': u'\u0943',
  u'ऌ': u'\u0962',
  u'ऍ': u'\u0946',
  u'ए': u'\u0947',
  u'ऐ': u'\u0948',
  u'ऑ': u'\u094A',
  u'ओ': u'\u094B',
  u'औ': u'\u094C',
  u'ॠ': u'\u0944',
  u'ॡ': u'\u0963',
}

for x in EXTRA[:-1]:
    VOWELS[x] = x


def convert(slp):
    result = []
    characters = [CONVERSION[ch] for ch in slp]
    for i in range(len(characters)):
        ch = characters[i]
        previous_was_consonant = i > 0 and characters[i - 1] not in VOWELS
        if ch == u'\u093c':
            previous = result.pop()
            result.append(NUKTAS.get(previous, previous))
        elif ch in VOWELS and previous_was_consonant:
            result.append(VOWELS[ch])
        elif ch not in VOWELS and previous_was_consonant:
            result.append(u'\u094d')
            result.append(ch)
        else:
            result.append(ch)
    return ''.join(result)



for line in open('datasets/wx.txt').readlines():
    (head, tail) = line.strip().split(' ')
    convertible = not any(x in tail for x in 'VY@0123456789_\xd9')
    converted = convert(tail) if convertible else '#%s' % (tail,)
    print ('%s %s %s' % (int(head), tail, converted)).encode('utf8')
