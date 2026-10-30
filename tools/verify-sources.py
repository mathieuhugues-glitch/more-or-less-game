#!/usr/bin/env python3
"""Fact-check helper: for every question, fetch its Wikipedia source (plain text + wikitext) and check that the
evidence regex from tools/source-hints.json appears. Prints the matching snippet so a human can read it.
Usage: python3 tools/verify-sources.py [id ...]"""
import json, re, sys, os, urllib.request, urllib.parse
D = os.path.dirname(os.path.abspath(__file__))
bank = json.load(open(os.path.join(D, '..', 'data', 'questions.json')))
hints = json.load(open(os.path.join(D, 'source-hints.json')))
UA = {'User-Agent': 'molparty-verify/1.0 (github.com/mathieuhugues-glitch/more-or-less-party)'}
cache = {}
def api(q): return json.load(urllib.request.urlopen(urllib.request.Request('https://en.wikipedia.org/w/api.php?format=json&redirects=1&' + q, headers=UA), timeout=30))
def page_text(url):
    page = urllib.parse.unquote(url.split('/wiki/')[1])
    if page not in cache:
        t = urllib.parse.quote(page)
        ex = list(api('action=query&prop=extracts&explaintext=1&titles=' + t)['query']['pages'].values())[0].get('extract', '')
        wt = api('action=parse&prop=wikitext&page=' + t)['parse']['wikitext']['*']
        cache[page] = ex + '\n' + wt
    return cache[page]
bad = 0
for q in bank['questions']:
    if len(sys.argv) > 1 and q['id'] not in sys.argv[1:]: continue
    h = hints.get(q['id'])
    if not h or '/wiki/' not in q['source']: print('SKIP (no hint or non-Wikipedia source)', q['id']); continue
    try: txt = page_text(q['source'])
    except Exception as e: print('ERR ', q['id'], e); bad += 1; continue
    m = re.search(h, txt, re.I)
    if not m: print('MISS', q['id'], q['source'], h); bad += 1; continue
    print('OK  ', q['id'], q['answer'], '|', txt[max(0, m.start() - 80):m.end() + 50].replace('\n', ' '))
print('problems:', bad); sys.exit(1 if bad else 0)
