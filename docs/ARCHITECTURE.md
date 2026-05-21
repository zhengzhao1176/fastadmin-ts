# 架构与设计说明 — fastadmin-ts

本文说明 TypeScript 复刻版的整体架构、关键子系统与设计取舍。配合根目录 `README.md` 阅读。

---

## 1. 总体分层

```
HTTP 请求
   │
   ▼
NestJS 控制器  (src/modules/**, src/controllers/**)
   │  ├─ AdminAuthGuard / FrontendAuthGuard  登录 + RBAC
   │  └─ HookInterceptor / 各 hook 埋点
   ▼
服务层  (src/services/**)
   │  BackendCrudService · ViewService · UploadService · StorageService
   │  HookService · AddonService · CacheService · QueueService · I18nService …
   ▼
TypeORM 实体  (src/entities/**)  ──►  MySQL
```

应用以 `src/main.ts` 引导，`src/app.module.ts` 为根模块，按 FastAdmin 的模块划分组织：

| 模块 | 路径前缀 | 职责 |
|------|----------|------|
| `AdminModule` | `/admin.php/*` | 后台：登录、仪表盘、权限、CRUD、常规管理、插件 |
| `FrontendModule` | `/index/*` | 前台：会员注册 / 登录 / 个人中心 |
| `ApiModule` | `/api/*` | API：统一信封 `{code,msg,time,data}` |
| `InfraModule` | — | `@Global` 基础设施：队列、定时任务、会员积分/余额 |
| `HealthModule` | `/health` | 健康检查 |

---

## 2. URL 与路由

FastAdmin 的入口是 `admin.php` / `index.php`。复刻版用 NestJS 控制器路径直接映射，例如
`@Controller('admin.php/category')` → `/admin.php/category/index`。这样前端同步过来的
`require-backend.js` 等资源无需修改即可工作。

---

## 3. CRUD 引擎 — `BackendCrudService`

对应 PHP `app\admin\library\traits\Backend` + `app\common\controller\Backend`。
泛型类，由各控制器注入仓储后复用：

- `buildParams(query)` — 复刻 `buildparams()`，把 bootstrap-table 的
  `search / filter / op / sort / order / offset / limit` 翻译为 TypeORM 查询。
  支持操作符 `= <> LIKE NOT LIKE > >= < <= IN NOT IN BETWEEN NOT BETWEEN
  RANGE NOT RANGE FIND_IN_SET NULL NOT NULL`，并把跨字段快速搜索拼为 OR-LIKE 子句。
- `index / add / edit / del / multi` — 通用增删改查。`del` 在实体含 `deletetime`
  列时执行软删除。
- `recyclebin / restore / destroy` — 回收站（软删除行的列出、还原、彻底删除）。
- `import` — CSV 导入：首行表头按列注释或列名映射到字段后批量插入。
- `selectpage` — 复刻 SelectPage 组件的服务端分页搜索接口。
- `normalizeRow` — 把多选数组折叠为 CSV、把 fieldlist 的提交结构归一为 JSON。

---

## 4. 视图层 — `ViewService`

轻量模板引擎（非完整 Twig），模板位于 `ts/views/<module>/`：

- `{{ x }}` / `{{ x|raw }}` / `{{ x|escape }}` / `{{ x|default('y') }}` — 变量替换
- `{{> partial/name }}` — 片段包含
- `{{ __('Key') }}` / `{{ __('Hi %s','name') }}` — i18n + sprintf 占位

控制器先把动态数据算好再渲染，模板只做替换与包含。`render()` 末尾触发 `view_filter`
hook，允许插件对最终 HTML 做最后一道过滤。

`renderListPage` / `renderFormPage` / `renderRecyclebinPage` 等快捷方法封装了
列表页、表单页、回收站页的通用骨架与 bootstrap-table 内联初始化脚本。

---

## 5. 配置注入 — `BackendConfigService`

每次渲染后台页面时构建 `requireConfig`（即 PHP 注入页面的 `var require = {config:…}`），
包含 site / upload / modulename / controllername / language / cookie 等字段，供前端
RequireJS 引导与 i18n 加载使用。构建过程中触发 `upload_config_init` 与 `config_init`
两个 hook，云存储等插件据此改写上传配置。

---

## 6. 代码生成器 — `bin/think crud`

`src/cli/lib/codegen.ts` 为纯函数代码生成器：

- `schema-introspect.ts` 读取 MySQL 表结构 → `TableInfo`
- `generateEntity` → TypeORM 实体
- `generateController` → CRUD 控制器（含回收站 / 导入路由，按 `deletetime` 列条件生成）
- `generateBackendJs` → 前端 AMD 模块
- `renderFieldsLiteral` 按字段名/类型约定选择表单控件
  （`*_id`→SelectPage、`*image(s)`→上传、enum→selectpicker、`array/json`→Fieldlist…）
- `isProtectedTable` 拒绝对核心表（`fa_admin` / `fa_user` 等）生成 CRUD

---

## 7. 鉴权与 RBAC

- `AdminAuthGuard` — 校验后台会话；无会话触发 `admin_nologin`、无权限触发
  `admin_nopermission`（hook 可放行），并按 `@NoNeedRight([...])` 装饰器跳过指定动作。
- `AdminAuthLibrary` — 复刻 `auth_rule` 规则树校验。
- `BackendCrudService` 的 `dataLimit`（`auth` / `personal`）实现数据范围限制。

---

## 8. 行为事件 — `HookService`

复刻 PHP `Hook::add / Hook::listen`：

- `listen(event, params)` — 异步串行执行处理器，处理器可改写 `params`。
- `filter(event, value)` — 同步过滤链（`view_filter` 等同步场景使用）。

已埋点事件：`module_init` `config_init` `upload_config_init` `login_init`
`admin_nologin` `admin_nopermission` `view_filter` `upload_after` `wipecache_after`
及会员登录/注册等。

---

## 9. 基础设施

- **CacheService / QueueService** — 优先 Redis，无 Redis 时降级为内存实现，NO-OP 安全。
- **SchedulerService** — 5 字段 cron 表达式匹配的定时任务调度器。
- **StorageService** — 本地存储 + S3 兼容云存储驱动（零依赖手写 SigV4 签名）。
- **UserBalanceService** — 会员积分/余额变动并写审计流水（`fa_user_money_log` /
  `fa_user_score_log`）。

---

## 10. 测试策略

`tests/` 是一套**黑盒对照测试**：同一批用例既跑 PHP 原版又跑 TS 复刻，两者输出一致即视为
复刻成功。

- `tests/{admin,api,index}/**` — 黑盒 HTTP 用例，经 `tests/helpers/http.ts` 统一封装
  cookie / CSRF / 信封解码。
- `tests/cross-cutting/**` — 纯函数单元测试（上传配置、buildParams、辅助类、Form、
  Hook 等），无需任何服务即可运行。
- `tests/helpers/global-setup.ts` — 每轮 `resetDb()` 重置测试库。
- `scripts/smoke.sh` — 25 项冒烟脚本，覆盖登录、仪表盘、菜单、CRUD、上传等主链路。

运行时用 `@swc-node/register` 做类型擦除直跑（不经 `tsc` 编译），因此少量 TypeORM 泛型
相关的 `tsc` 报错不影响运行。
