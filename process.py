import collections
import csv
import os
import sys


dictionary = set()

for line in list(csv.reader(open('datasets/dictionary.txt')))[1:]:
    dictionary.add(line[1].decode('utf8'))


def filter_entries(entries):
    result = []
    for (latin, hindi) in entries:
        latin = latin.lower()
        if hindi.endswith('**'):
            continue
        latin = latin.strip('?').strip('!').strip(',')
        hindi = hindi.strip('?').strip('!').strip(',')
        if not all(x.isalpha() for x in latin):
            continue
        if hindi not in dictionary:
            print 'Unknown Hindi word: %s' % (hindi,)
            continue
        result.append((latin, hindi))
    return result


def get_entries(name):
    lines = open(name).read().decode('utf8').split('\n')
    lines = [x.strip() for x in lines if x.strip()]
    assert(len(lines) % 2 == 0)
    result = []
    for i in range(0, len(lines), 2):
        (latin, hindi) = map(split, (lines[i], lines[i + 1]))
        assert(len(latin) == len(hindi)), (name, (latin, hindi))
        result.extend(zip(latin, hindi))
    return result


def get_source(name):
    return os.path.basename(os.path.dirname(name))


def split(line):
    return [x.strip() for x in line.strip(';').split(';') if x.strip()]


data = collections.defaultdict(list)

for name in sys.argv[1:]:
    if name.endswith('lyrics.txt'):
        lines = open(name).read().decode('utf8').split('\n')
        lines = [x.strip() for x in lines if x.strip()]
        entries = [x.split('\t') for x in lines]
        assert(all(len(x) == 2 for x in entries))
        source = 'Lyrics'
    else:
        entries = get_entries(name)
        source = get_source(name)
    source = source.split(' ')[0].lower()
    data[source].extend(filter_entries(entries))

with open('combined.txt', 'w') as output:
    for (source, entries) in sorted(data.items()):
        output.write('// %s\n' % (source,))
        for (latin, hindi) in entries:
            output.write(('%s\t%s\n' % (latin, hindi)).encode('utf8'))
