import json, sys
a = {x['name']: x for x in json.load(open(sys.argv[1]))}
b = {x['name']: x for x in json.load(open(sys.argv[2]))} if len(sys.argv) > 2 else {}
for n, x in a.items():
    y = b.get(n)
    o = ' '.join(f'{k}:{p}>{q}' for k, (p, q) in x['open'].items() if p or q)
    s = f"{n[:32]:32} {x['ampel'][0]}>{x['ampelAfter'][0]} crit {x['crit']:4}>{x['critAfter']:4} new {x['newCrit']:3} caut+{x['newCaution']:3} gs+{x['newGapSparse']:3} obj {x['objects']:2} {x['ms']:6}ms {o}"
    if y: s += f"   | old {y['critAfter']:4} new {y['newCrit']:3} {y['ms']:6}ms"
    print(s)
