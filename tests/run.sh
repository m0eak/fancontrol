#!/bin/sh
#
# Checks for the fancontrol package. Runs the host-side C regression tests
# under a sanitiser, then the cheap static checks on the LuCI app, its ACL and
# the translation catalog. Used by CI and runnable locally:
#
#     ./tests/run.sh
#
# Requires: cc, node, python3, msgfmt (from the gettext package).
#
set -e

root="$(cd "$(dirname "$0")/.." && pwd)"
cc="${CC:-cc}"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT

view="$root/luci-app-fancontrol/htdocs/luci-static/resources/view/fancontrol.js"
po="$root/luci-app-fancontrol/po/zh_Hans/fancontrol.po"

echo "== C regression tests (ASan + UBSan) =="
"$cc" -O1 -g -Wall -Wextra -fsanitize=address,undefined \
	-o "$build/fancontrol_test" "$root/tests/c/fancontrol_test.c"
"$build/fancontrol_test"

echo
echo "== LuCI view parses as JavaScript =="
# The view uses a top-level return, which LuCI wraps in a function, so it is
# parsed inside one here as well; node --check would reject it.
node -e 'new Function(require("fs").readFileSync(process.argv[1], "utf8"));' "$view"
echo "ok"

echo
echo "== ACL and menu files parse as JSON =="
python3 - "$root" <<'PY'
import glob, json, sys
paths = sorted(glob.glob(sys.argv[1] + "/luci-app-fancontrol/**/*.json", recursive=True))
if not paths:
    raise SystemExit("no JSON files found")
for path in paths:
    json.load(open(path))
    print("ok   " + path.split("/luci-app-fancontrol/")[-1])
PY

echo
echo "== Translation catalog is valid and covers every string =="
msgfmt --check -o /dev/null "$po"
python3 - "$view" "$po" <<'PY'
import re, sys
# 约定：view 里的可翻译字符串一律写单引号（`_('...')`），这里按该约定提取
js = open(sys.argv[1], encoding="utf-8").read()
po = open(sys.argv[2], encoding="utf-8").read()
used = set(re.findall(r"_\(\s*'((?:[^'\\]|\\.)*)'\s*\)", js))
have = set(re.findall(r'^msgid\s+"((?:[^"\\]|\\.)*)"\s*$', po, re.M))
have.discard("")
missing = sorted(used - have)
if missing:
    raise SystemExit("untranslated strings: %s" % ", ".join(missing))
print("ok   %d/%d strings translated" % (len(used), len(used)))
PY

echo
echo "all checks passed"
