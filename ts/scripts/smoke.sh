#!/usr/bin/env bash
# Automated walkthrough of the visual-smoke checklist.
# Runs every step in docs/visual-smoke.md except the manual browser ones.
#
# Usage:
#   PORT=8888 npm run smoke
#   PORT=8888 BASE=http://127.0.0.1:8888 bash scripts/smoke.sh
#
# Exits 0 if all steps pass, 1 otherwise.

set -u
PORT="${PORT:-8888}"
BASE="${BASE:-http://127.0.0.1:$PORT}"
JAR=$(mktemp -t fasmoke.XXXXXX)
TMP=$(mktemp -d -t fasmoke.XXXXXX)
trap 'rm -f "$JAR"; rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
STEP=0

step() {
  STEP=$((STEP + 1))
  printf '\n\033[1;36m== Step %d — %s\033[0m\n' "$STEP" "$1"
}

ok() {
  PASS=$((PASS + 1))
  printf '   \033[32m✓\033[0m %s\n' "$1"
}

bad() {
  FAIL=$((FAIL + 1))
  printf '   \033[31m✗\033[0m %s\n' "$1"
  if [ "${2:-}" != "" ]; then
    printf '     got: %s\n' "$2"
  fi
}

# Wait for server (up to 15s)
step "Wait for server at $BASE"
for i in $(seq 1 30); do
  if curl -sf "$BASE/health" >/dev/null 2>&1; then
    ok "server is responding"
    break
  fi
  sleep 0.5
done
if ! curl -sf "$BASE/health" >/dev/null 2>&1; then
  bad "server not reachable after 15s — start it with 'PORT=$PORT npm start'"
  exit 1
fi

# 1. Static assets
step "Static assets (backend.css + require.js)"
CSS_CT=$(curl -sI "$BASE/assets/css/backend.css" | grep -i '^content-type:' | tr -d '\r')
JS_CT=$(curl -sI "$BASE/assets/js/require.js" | grep -i '^content-type:' | tr -d '\r')
if echo "$CSS_CT" | grep -qi 'text/css'; then ok "backend.css served as text/css"; else bad "backend.css wrong content-type" "$CSS_CT"; fi
if echo "$JS_CT" | grep -qi 'javascript'; then ok "require.js served as javascript"; else bad "require.js wrong content-type" "$JS_CT"; fi

# 2. Login page HTML — save cookies so the session can be reused for token POST
step "Login page HTML markers"
curl -sS -c "$JAR" -b "$JAR" "$BASE/admin.php/index/login" > "$TMP/login.html"
MARKERS=$(grep -oE 'login-screen|backend\.css|require\.js|__token__' "$TMP/login.html" | sort -u | wc -l | tr -d ' ')
if [ "$MARKERS" -ge 4 ]; then ok "all 4 AdminLTE markers present"; else bad "expected 4 markers, got $MARKERS"; fi

# 3. Login flow
step "Login flow (admin/123456)"
TOKEN=$(grep -oE 'name="__token__"[^>]*value="[a-f0-9]{20,}"|value="[a-f0-9]{20,}"[^>]*name="__token__"' "$TMP/login.html" | head -1 | grep -oE 'value="[a-f0-9]{20,}"' | sed -E 's/value="([^"]+)"/\1/')
if [ -z "$TOKEN" ]; then
  TOKEN=$(grep -oE 'value="[a-f0-9]{20,}"' "$TMP/login.html" | head -1 | sed -E 's/value="([^"]+)"/\1/')
fi
if [ -z "$TOKEN" ]; then
  bad "could not extract __token__ from login page"
  TOKEN="dummy"
else
  ok "extracted CSRF token (${#TOKEN} chars)"
fi
LOGIN_RESP=$(curl -sS -c "$JAR" -b "$JAR" -H "X-Requested-With: XMLHttpRequest" \
  --data-urlencode "username=admin" \
  --data-urlencode "password=123456" \
  --data-urlencode "keeplogin=0" \
  --data-urlencode "__token__=$TOKEN" \
  "$BASE/admin.php/index/login")
if echo "$LOGIN_RESP" | grep -q '"code":1'; then
  ok "login returned code 1"
else
  bad "login failed" "$LOGIN_RESP"
fi

# 4. Dashboard
# /admin.php/index/index now serves the AdminLTE *shell* (header + sidebar +
# empty tab container); the stats panel lives at /admin.php/dashboard/index
# and is loaded into a tab pane by JS. Pull both and assert chrome markers
# on the shell + stats markers on the dashboard URL.
step "Dashboard page renders"
curl -sS -b "$JAR" "$BASE/admin.php/index/index" > "$TMP/dashboard.html"
SHELL_MARKERS=$(grep -oE 'main-sidebar|main-header|content-wrapper|tab-addtabs|sidebar-menu' "$TMP/dashboard.html" | sort -u | wc -l | tr -d ' ')
curl -sS -b "$JAR" "$BASE/admin.php/dashboard/index" > "$TMP/dashboard-stats.html"
DASH_MARKERS=$(grep -oE 'info-box|userdata|column|echart_user|total' "$TMP/dashboard-stats.html" | sort -u | wc -l | tr -d ' ')
if [ "$SHELL_MARKERS" -ge 4 ] && [ "$DASH_MARKERS" -ge 4 ]; then
  ok "shell has $SHELL_MARKERS/5 AdminLTE markers, stats has $DASH_MARKERS/5 dashboard markers"
else
  bad "shell=$SHELL_MARKERS/5 stats=$DASH_MARKERS/5 (need ≥4 each)"
fi

# 5. Menu refresh
step "Menu refresh AJAX"
MENU=$(curl -sS -b "$JAR" -H "X-Requested-With: XMLHttpRequest" -X POST \
  --data-urlencode "action=refreshmenu" \
  "$BASE/admin.php/index/index")
if echo "$MENU" | grep -q '"menulist"'; then ok "menu refresh returned menulist"; else bad "no menulist" "$MENU"; fi

# 6. Category CRUD page
step "Category CRUD page renders"
curl -sS -b "$JAR" "$BASE/admin.php/category/index" > "$TMP/category.html"
CAT_MARKERS=$(grep -oE 'btn-add|btn-edit|btn-del|category-list|toolbar' "$TMP/category.html" | sort -u | wc -l | tr -d ' ')
if [ "$CAT_MARKERS" -ge 4 ]; then ok "category page has $CAT_MARKERS/5 CRUD markers"; else bad "expected ≥4 markers, got $CAT_MARKERS"; fi

# 7. i18n (zh-cn + en)
step "i18n language pack lookup"
LANG_ZH=$(curl -sS "$BASE/admin.php/ajax/lang?controllername=category&lang=zh-cn")
if echo "$LANG_ZH" | grep -q 'define('; then ok "zh-cn pack wrapped in define()"; else bad "zh-cn not wrapped" "$LANG_ZH"; fi
LANG_EN=$(curl -sS "$BASE/admin.php/ajax/lang?controllername=category&lang=en")
if echo "$LANG_EN" | grep -q '"Category"'; then ok "en pack contains Category key"; else bad "en pack missing translations" "$LANG_EN"; fi

# 8. Captcha randomness
step "Captcha randomness"
curl -sS "$BASE/api/common/captcha" > "$TMP/c1.svg"
curl -sS "$BASE/api/common/captcha" > "$TMP/c2.svg"
if ! diff -q "$TMP/c1.svg" "$TMP/c2.svg" >/dev/null; then ok "two captchas differ"; else bad "two captcha responses identical"; fi

# 9. Health
step "Health endpoint"
HEALTH=$(curl -sS "$BASE/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then ok "health returns status: ok"; else bad "health unhealthy" "$HEALTH"; fi

# 10. Security headers
step "Security headers (helmet)"
HEADERS=$(curl -sI "$BASE/health")
for hdr in 'content-security-policy' 'strict-transport-security' 'x-content-type-options' 'x-frame-options'; do
  if echo "$HEADERS" | grep -qi "^$hdr:"; then ok "$hdr present"; else bad "$hdr missing"; fi
done

# 11. Multi-tab redirect (only meaningful when authenticated — uses the JAR from login).
# Use a real GET (not HEAD via curl -I) — the interceptor only fires on GET.
step "Multi-tab redirect (?ref=addtabs)"
REDIRECT=$(curl -s -D - -o /dev/null -b "$JAR" "$BASE/admin.php/category/index?ref=addtabs")
if echo "$REDIRECT" | grep -qi '^HTTP/1.[01] 30[12]'; then ok "redirect status 30x"; else bad "expected 30x redirect" "$(echo "$REDIRECT" | head -1)"; fi
LOC=$(echo "$REDIRECT" | grep -i '^location:' | tr -d '\r')
if echo "$LOC" | grep -qiE 'referer=.*category|/admin\.php/index/index'; then ok "location header set ($LOC)"; else bad "location header missing or unexpected" "$LOC"; fi

# 12. Wipecache
step "Wipecache AJAX"
WIPE=$(curl -sS -b "$JAR" -H "X-Requested-With: XMLHttpRequest" -X POST \
  --data-urlencode "type=all" \
  "$BASE/admin.php/ajax/wipecache")
if echo "$WIPE" | grep -q '"code":1'; then ok "wipecache returned code 1"; else bad "wipecache failed" "$WIPE"; fi

# 13. Addon listing
step "Addon downloaded list"
ADDONS=$(curl -sS -b "$JAR" "$BASE/admin.php/addon/downloaded")
if echo "$ADDONS" | grep -qE '"(total|rows)"'; then ok "addon list returns total/rows"; else bad "no addon list" "$ADDONS"; fi

# 14. Frontend home (C08)
step "Frontend home page"
curl -sS "$BASE/index/index" > "$TMP/home.html"
if grep -q 'FastAdmin' "$TMP/home.html"; then ok "frontend home contains FastAdmin"; else bad "frontend home does not render"; fi

# 15. Frontend user/login (C08)
step "Frontend user login template"
curl -sS "$BASE/index/user/login" > "$TMP/uilogin.html"
if grep -qiE 'login|username|password' "$TMP/uilogin.html"; then ok "frontend login template renders"; else bad "frontend login template empty"; fi

# 16. Bare /admin.php redirect
step "Bare /admin.php redirects to /index/index"
ROOT=$(curl -sI "$BASE/admin.php" | head -3)
if echo "$ROOT" | grep -qiE '^HTTP/1.[01] 30[12]'; then ok "bare /admin.php returned 302/301"; else bad "bare /admin.php no redirect" "$(echo "$ROOT" | head -1)"; fi

# 17. think --help
step "bin/think --help"
HELP_OUT=$(cd "$(dirname "$0")/.." && bash bin/think --help 2>&1 || true)
if echo "$HELP_OUT" | grep -qiE 'install|crud|menu|addon'; then ok "think CLI lists subcommands"; else bad "think --help missing subcommands" "$(echo "$HELP_OUT" | head -3)"; fi

# Summary
printf '\n\033[1m== Summary: %d passed, %d failed (out of %d checks)\033[0m\n' "$PASS" "$FAIL" $((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32mAll smoke checks green.\033[0m\n'
  exit 0
else
  printf '\033[1;31mSome checks failed.\033[0m\n'
  exit 1
fi
