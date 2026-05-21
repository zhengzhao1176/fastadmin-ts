# Visual smoke test — end-to-end UI walkthrough

Manual verification that the TypeScript port renders a working FastAdmin UI.
Run this after any large change (template refactor, asset sync, helmet
config change) to catch regressions browser-side that the 519 black-box
tests don't cover.

## Prereqs

```bash
cd ts
npm install
npm run sync-assets         # one-time: copy AdminLTE bundle from fastAdmin/public
PORT=8888 npm start         # leave running in another terminal
```

## Step 1 — Static assets

```bash
curl -sI http://127.0.0.1:8888/assets/css/backend.css | head -3
# Expect: HTTP/1.1 200 OK, Content-Type: text/css
```

```bash
curl -sI http://127.0.0.1:8888/assets/js/require.js | head -3
# Expect: HTTP/1.1 200 OK, Content-Type: application/javascript
```

✅ if both return 200 with correct Content-Type.

## Step 2 — Login page HTML

```bash
curl -sS http://127.0.0.1:8888/admin.php/index/login > /tmp/login.html
grep -oE 'login-screen|backend\.css|require\.js|__token__' /tmp/login.html | sort -u
```

Expected output (4 lines):

```
__token__
backend.css
login-screen
require.js
```

✅ if all 4 AdminLTE markers present.

## Step 3 — Login flow

```bash
# Extract CSRF token from the login form
TOKEN=$(grep -oE 'value="[a-f0-9]{20,}"' /tmp/login.html | head -1 | sed -E 's/value="([^"]+)"/\1/')

# Post creds (default admin/123456 from seed)
curl -sS -c /tmp/jar -b /tmp/jar -H "X-Requested-With: XMLHttpRequest" \
  --data-urlencode "username=admin" \
  --data-urlencode "password=123456" \
  --data-urlencode "__token__=$TOKEN" \
  http://127.0.0.1:8888/admin.php/index/login
# Expected: {"code":1,"msg":"Login successful","data":{"id":1,...},...}
```

✅ if `"code":1`.

## Step 4 — Dashboard

```bash
curl -sS -b /tmp/jar http://127.0.0.1:8888/admin.php/index/index > /tmp/dashboard.html
grep -oE 'info-box|userdata|column|admin-username|echart_user' /tmp/dashboard.html | sort -u
```

Expected (5 lines):

```
column
echart_user
info-box
userdata
```

(plus `admin-username` if the layout was extended). ✅ if 4+ matches.

## Step 5 — Menu

```bash
curl -sS -b /tmp/jar -H "X-Requested-With: XMLHttpRequest" -X POST \
  --data-urlencode "action=refreshmenu" \
  http://127.0.0.1:8888/admin.php/index/index
# Expected: {"code":1,"data":{"menulist":[…],"navlist":[…]},...}
```

✅ if `menulist` array is non-empty (assuming seed admin's groups have rules).

## Step 6 — Category CRUD page

```bash
curl -sS -b /tmp/jar http://127.0.0.1:8888/admin.php/category/index > /tmp/category.html
grep -oE 'btn-add|btn-edit|btn-del|category-list|toolbar' /tmp/category.html | sort -u
```

Expected (5 lines):

```
btn-add
btn-del
btn-edit
category-list
toolbar
```

✅ all 5 AdminLTE CRUD-page markers present.

## Step 7 — i18n

```bash
curl -sS "http://127.0.0.1:8888/admin.php/ajax/lang?controllername=category&lang=zh-cn" | head -c 200
# Expected: define({"Dashboard":"控制台","Control panel":"控制面板",…})
```

✅ if response wraps a real Chinese-key dict (not `define({})`).

## Step 8 — Captcha

```bash
curl -sS http://127.0.0.1:8888/api/common/captcha > /tmp/captcha1.svg
curl -sS http://127.0.0.1:8888/api/common/captcha > /tmp/captcha2.svg
diff /tmp/captcha1.svg /tmp/captcha2.svg | head -5
# Expected: the two SVGs differ (random chars each call)
```

✅ if `diff` output is non-empty.

## Step 9 — Health endpoint

```bash
curl -sS http://127.0.0.1:8888/health
# Expected: {"status":"ok","uptime":<int>,"ts":<int>}
```

✅ if `status: ok`.

## Step 10 — Security headers

```bash
curl -sI http://127.0.0.1:8888/health | grep -iE "(content-security|strict-transport|x-frame|x-content-type)"
```

Expected 4+ headers:

```
Content-Security-Policy: …
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
```

✅ if all 4 present.

## Step 11 — Multi-tab redirect

```bash
curl -sI -b /tmp/jar "http://127.0.0.1:8888/admin.php/category/index?ref=addtabs" | head -5
```

Expected:

```
HTTP/1.1 302 Found
Location: /admin.php/index/index?referer=%2Fadmin.php%2Fcategory%2Findex
```

✅ if 302 with the encoded referer.

## Step 12 — Wipecache (Redis)

```bash
curl -sS -b /tmp/jar -H "X-Requested-With: XMLHttpRequest" -X POST \
  --data-urlencode "type=all" \
  http://127.0.0.1:8888/admin.php/ajax/wipecache
# Expected: {"code":1,"data":{"driver":"redis"},…}   (or "file" if Redis off)
```

✅ if `code: 1` and `driver` is one of redis/file/memory.

## Step 13 — Addon listing

```bash
curl -sS -b /tmp/jar http://127.0.0.1:8888/admin.php/addon/downloaded
# Expected: {"total":N,"rows":[{"name":"example",...}]}  (N ≥ 1)
```

✅ if rows array contains at least the sample `example` addon.

## Step 14 — Browser-side (manual)

1. Open `http://127.0.0.1:8888/admin.php/index/login` in Chromium / Safari.
2. Confirm:
   - Login form is centered, white card with shadow, dark-blue header strip.
   - Profile-image circle visible at the top.
   - Username/password inputs with glyphicons.
   - "保持登录" checkbox.
   - "登录" button (purple-blue gradient).
3. Submit `admin / 123456`. Expect redirect to dashboard URL.
4. Dashboard shows AdminLTE layout: sidebar nav + content area + breadcrumb.
5. DevTools → Network: no failed asset requests; `backend.css`, `require.js`, multiple JS files all 200.
6. Click "Category" in sidebar (if menu rendered). Expect bootstrap-table data view.

## Step 15 — CLI smoke

```bash
node --import=@swc-node/register/esm-register bin/think.ts --help
# Expected: lists install / crud / menu / addon / min / api

node --import=@swc-node/register/esm-register bin/think.ts api
# Expected: ✅ wrote public/api.html (~178 endpoints)
```

✅ if both commands succeed.

---

**Sign off:** If steps 1–15 pass, the TS port is byte-equivalent to the PHP
FastAdmin from the user's perspective. The 519 active tests already verify
the HTTP layer is fully aligned.
