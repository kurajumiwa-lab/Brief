#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Run every preview suite and report an HONEST total.
#
# Why this exists: a hand-rolled `for` loop that greps for a summary line
# silently scores a CRASHED suite as "0 passed / 0 failed". Seven broken
# suites once hid behind a green-looking total that way. This runner treats a
# missing summary as a hard failure, which is what it is.
#
# Usage:  ./run-suites.sh            # all suites
#         ./run-suites.sh inbox dest # named suites only
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")"

cd preview || exit 1
export PATH="../node_modules/.bin:$PATH"

ALL="access admin alerts moneyband utf8 apic menusheet shopbuilder dukabook trust personal entities membersdesk fees rewards gate mshikano batch1 camp circleops capture collections commerce chain darkshelf dest econ engine feedcards group groupui inbox ing joins loops media nav news notifications onboard orchestration parse person pmatch pure pursuit quests resale routes session stories sys townhubs spaceloop circlejoin motion partnerdesk yousurface earnsurface progressivedisclosure tablebankingsurface eventcard eventactions eventdetail polish firstrun spacesignals promocarousel spaceshell wairodispatch cityfeed position commitments reciprocity museumgallery homezones spaceoperating spaceedit youposition errandslobby spacestorefront discoverlayout room publicface guardians sellerhardening appbelt shopbrief doorways cards backdoors sellphotos"
# discovery.jsx is in ALL because it is a real suite that was silently missing:
# 216 lines and 25 checks, one of them failing, and it appeared in no total this
# script ever printed. An unlisted suite never runs, and a suite that never runs
# cannot fail — the same class of lie as a test that cannot fail.
ALL="$ALL discovery mine tiles wairobrand spacemoderation"

# Files that look like suites but are not, each with the reason it is excluded.
# Keeping the reasons here is what stops the next reader from "fixing" the list
# by adding them, and stops a real suite from hiding among them.
#   dbg        18 lines of scratch, no checks, prints nothing
#   e2e        does not build (esbuild fails on it)
#   e2e.final  crashes; a hand-run end-to-end script, not a suite
#   live       needs a REAL server on a real port ("the REAL typed client
#              against a REAL running server"), so it cannot run in this runner
#   dbg.cjs / e2e.cjs   build artifacts written with a .jsx suffix appended
NOT_SUITES="dbg e2e e2e.final live dbg.cjs e2e.cjs"

SUITES="${*:-$ALL}"

# --- orphan guard -----------------------------------------------------------
# Fail loudly on a .jsx file that is in neither list. Without this, adding a
# suite and forgetting to list it produces a green total that never measured it.
if [ -z "${*:-}" ]; then
  orphans=""
  for f in *.jsx; do
    n="${f%.jsx}"
    case " $ALL " in *"$n "*) continue ;; esac
    case " $NOT_SUITES " in *"$n "*) continue ;; esac
    orphans="$orphans $n"
  done
  if [ -n "$orphans" ]; then
    echo "ORPHANED SUITES:$orphans"
    echo "  These .jsx files are in neither ALL nor NOT_SUITES, so they never run."
    echo "  Add the suite to ALL, or name it in NOT_SUITES with a reason."
    exit 1
  fi
fi

tot_p=0; tot_f=0; broken=""

for f in $SUITES; do
  if ! npx esbuild "$f.jsx" --bundle --platform=node --outfile=".tmp.$f.cjs" \
       --format=cjs --loader:.tsx=tsx --loader:.webp=empty --external:jsdom > ".tmp.$f.build" 2>&1; then
    printf "  %-9s BUILD FAILED\n" "$f"
    head -5 ".tmp.$f.build" | sed 's/^/      /'
    broken="$broken $f"; rm -f ".tmp.$f.cjs" ".tmp.$f.build" ".tmp.$f.css"; continue
  fi
  rm -f ".tmp.$f.build"
  # Bundling a tree that imports CSS emits a sibling .css. Clean it too
  # so a suite run leaves no stray artifact.
  rm -f ".tmp.$f.css"

  out=$(timeout 180 node ".tmp.$f.cjs" 2>&1); code=$?
  rm -f ".tmp.$f.cjs"

  # Anchored, and only a summary: a suite that dies mid-run prints lines like
  # "PASS 9. the contact channel is one honest input", which an unanchored grep
  # happily reads as "9 passed" and reports as GREEN. That is the exact failure
  # this runner exists to catch, so the pattern must not match a test name.
  line=$(echo "$out" | grep -Ei "^(pass|PASSED)[ ]+[0-9]+((([ ]*/?[ ]+)(fail|FAIL|FAILED)[ ]+[0-9]+))?$" | tail -1)
  p=$(echo "$line" | grep -oEi "(pass|PASSED) +[0-9]+" | grep -oE "[0-9]+")
  fl=$(echo "$line" | grep -oEi "(fail|FAILED) +[0-9]+" | grep -oE "[0-9]+")

  # No summary line means the suite died before finishing. Never score it 0/0.
  if [ -z "$line" ]; then
    printf "  %-9s CRASHED / NO SUMMARY (exit %s)\n" "$f" "$code"
    echo "$out" | grep -E "TypeError|ReferenceError|Error:" | head -3 | sed 's/^/      /'
    broken="$broken $f"; continue
  fi

  printf "  %-9s %4s passed  %4s failed\n" "$f" "${p:-0}" "${fl:-0}"
  [ "${fl:-0}" != "0" ] && echo "$out" | grep "FAIL " | head -8 | sed 's/^/      /'
  tot_p=$((tot_p + ${p:-0})); tot_f=$((tot_f + ${fl:-0}))
done

echo "-------------------------------------------------"
echo "TOTAL: $tot_p passed / $tot_f failed"
if [ -n "$broken" ]; then
  echo "CRASHED SUITES:$broken"
  echo "RESULT: NOT GREEN"
  exit 1
fi
[ "$tot_f" != "0" ] && { echo "RESULT: NOT GREEN"; exit 1; }
echo "RESULT: GREEN"
