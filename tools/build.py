#!/usr/bin/env python3
"""Genera index.html (un solo archivo) a partir de src/base.html + src/cava.js + src/seed_cava.json."""
import json, pathlib
raiz = pathlib.Path(__file__).resolve().parent.parent
base = (raiz/'src'/'base.html').read_text(encoding='utf8')
seed = (raiz/'src'/'seed_cava.json').read_text(encoding='utf8')
js = (raiz/'src'/'cava.js').read_text(encoding='utf8')
assert '<!--CAVA-SEED-->' in base and '<!--CAVA-JS-->' in base
seed_tag = '<script>\n/* Datos de cava tomados del Excel CONTROL PROCESO CAVAS 2026 */\nwindow.App=window.App||{};App.SEED=Object.assign(App.SEED||{},' + seed.replace('</', '<\\/') + ');\n</script>'
html = base.replace('<!--CAVA-SEED-->', seed_tag).replace('<!--CAVA-JS-->', '<script>\n' + js + '\n</script>')
(raiz/'index.html').write_text(html, encoding='utf8')
print('index.html', len(html)//1024, 'KB')
