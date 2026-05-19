#!/usr/bin/env python3
"""Extract key data points from fmigs-cbg-migs.json for the interactive page."""
import json
import re

d = json.load(open('/Users/beans/Developer/MountZara/MIGS/assets/curriculum/fmigs-cbg-migs.json'))

print('=== chapter titles ===')
for c in d['chapters']:
    print(f"{c['number']:>2}. {c['title']}")

print('\n=== ch12 monthly didactic sections (in order) ===')
for s in d['chapters'][11]['sections']:
    if re.match(r'^[A-Z][a-z]+ \(Y[12]\)', s['heading']):
        print(' ', s['heading'])

print('\n=== ch11 site sections ===')
for s in d['chapters'][10]['sections']:
    if any(k in s['heading'] for k in ('Hospital', 'St.', 'Saint', 'Thorek', 'UIC', '(SFH)', '(SJH)', '(SMH)', '(TMH)')):
        print(' ', s['heading'])
