# -*- coding: utf-8 -*-


def build_dict(keys, values):
    assert(len(keys) == len(values))
    return dict(zip(keys, values))


HINDI = u'अआइईउऊएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहऋॠऌॡ'
LATIN = u'aAiIuUeEoOkKgGNcCjJYwWqQRtTdDnpPbBmyrlvSzshfFxX'

HINDI = HINDI + u'अंअःअ़'[1::2]
LATIN = LATIN + u'MHZ'

CONVERSION = build_dict(LATIN, HINDI)
NUKTAS = build_dict(u'कखगजडढफ', u'क़ख़ग़ज़ड़ढ़फ़')

VOWELS = {
  'अ': '',
  'आ': '\u093E',
  'इ': '\u093F',
  'ई': '\u0940',
  'उ': '\u0941',
  'ऊ': '\u0942',
  'ऋ': '\u0943',
  'ऌ': '\u0962',
  'ऍ': '\u0946',
  'ए': '\u0947',
  'ऐ': '\u0948',
  'ऑ': '\u094A',
  'ओ': '\u094B',
  'औ': '\u094C',
  'ॠ': '\u0944',
  'ॡ': '\u0963',
}


def convert(slp):
    result = []
    characters = [CONVERSION[ch] for ch in slp]
    for i in range(len(characters)):
        ch = characters[i]
        if ch == u'\u093c':
            result.append(NUKTAS[result.pop()])
        else:
            result.append(ch)
    return ''.join(result)



for line in open('datasets/slp.txt').readlines():
    (head, tail) = line.strip().split(' ')
    if all(x not in tail for x in 'V@0123456789_\xd9'):
        print ('%s\t%s' % (int(head), convert(tail))).encode('utf8')
