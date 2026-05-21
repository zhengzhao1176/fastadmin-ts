# fastadmin-ts

> 使用 **NestJS + TypeORM** 对 PHP 框架 [FastAdmin](https://www.fastadmin.net/) 进行的 TypeScript 功能复刻 —— 目标是「功能一模一样」。

FastAdmin 是基于 ThinkPHP 5 + Bootstrap 的快速后台开发框架。本项目用 TypeScript 重新实现其后端（admin / index / api 三大模块）、CRUD 代码生成器、命令行工具与全部核心组件，并以一套**黑盒测试套件**对照 PHP 原版逐接口校验，保证行为一致。

---

## ✅ 当前状态

| 指标 | 结果 |
|------|------|
| 黑盒/单元测试 | **645 passed / 100 skipped / 0 failed**（49 个测试文件） |
| 冒烟测试 | **25 / 25 通过** |
| 对照基准 | 与 PHP 原版 FastAdmin 逐接口黑盒对照 |

测试套件 `tests/` 既校验 PHP 原版，也校验本 TS 复刻 —— 两者行为一致即视为「复刻成功」。

---

## 🧱 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js ≥ 20，TypeScript（`@swc-node/register` 类型擦除直跑） |
| 框架 | NestJS 10 |
| ORM | TypeORM 0.3（MySQL） |
| 缓存 / 队列 | Redis（无 Redis 时自动降级为内存实现） |
| 前端 | AdminLTE + RequireJS + jQuery + bootstrap-table（资源同步自 FastAdmin） |
| 模板 | 自研轻量模板引擎（`{{ x }}` / `{{ x|raw }}` / `{{> partial }}` / `{{ __('Key') }}`） |
| 错误追踪 | Sentry（后端 `@sentry/nestjs` + 前端 `@sentry/browser` + Session Replay，可选） |
| 测试 | Vitest（黑盒 HTTP + 纯函数单元测试） |

---

## 📁 目录结构

```
.
├── ts/                       TypeScript 复刻主体
│   ├── src/
│   │   ├── main.ts           应用引导
│   │   ├── app.module.ts     根模块
│   │   ├── modules/          功能模块 admin / index / api / health / infra
│   │   ├── controllers/...   各业务控制器
│   │   ├── services/         backend-crud / view / upload / storage / hook
│   │   │                     / addon / cache / queue / scheduler / i18n …
│   │   ├── entities/         TypeORM 实体
│   │   ├── common/           辅助类 date / pinyin / rsa / http / form
│   │   │                     / random / helpers / tree …
│   │   ├── guards/           登录与 RBAC 守卫
│   │   └── cli/              `think` 命令行（crud / menu / min / api / addon / install）
│   ├── bin/think             CLI 入口
│   ├── views/                后台模板
│   ├── public/assets/        前端静态资源
│   └── lang/                 多语言包（zh-cn / en）
├── tests/                    黑盒 + 单元测试套件
├── docs/                     项目技术文档（使用 / 架构 / 基线报告）
├── docker/                   测试栈 docker-compose（MySQL / Redis / PHP / MailHog）
├── scripts/                  数据库重置、种子、冒烟脚本
└── .github/workflows/        CI（基线测试）
```

> 以下内容为第三方代码，**未纳入本仓库**，需运行对照测试时另行获取：
> - `fastAdmin/` —— PHP 原版 FastAdmin（测试对照基准，GPL）
> - `doc/` —— FastAdmin 官方开发文档；请直接查阅官网 <https://doc.fastadmin.net/>

---

## 🚀 快速开始

```bash
# 1. 安装依赖（根目录为测试套件，ts/ 为应用）
npm install
cd ts && npm install && cd ..

# 2. 准备环境变量
cp .env.test.example .env.test      # 按需修改数据库 / Redis 连接

# 3. 启动依赖栈（MySQL / Redis）
cd docker && docker compose up -d && cd ..

# 4. 初始化数据库
npm run db:reset

# 5. 启动 TS 服务
cd ts && PORT=8888 npm start
# 浏览器打开 http://127.0.0.1:8888/admin.php/index/login  （admin / 123456）
```

---

## 🧪 测试

```bash
npm test                     # 全量 vitest（645 通过 / 100 跳过）
cd ts && PORT=8888 npm run smoke   # 冒烟测试（25 项）
cd ts && npm run typecheck         # 类型检查
```

> 完整黑盒对照测试默认指向 PHP 原版（`FASTADMIN_BASE_URL`，默认 `:8787`）。若只验证 TS 复刻，将该变量指向 TS 服务端口即可；纯函数单元测试（`tests/cross-cutting/*`）无需任何服务即可运行。

---

## 🛠️ 命令行 `bin/think`

复刻自 PHP 的 `php think`：

| 命令 | 说明 |
|------|------|
| `crud -t <表> [-f] [-d]` | 由数据库表一键生成实体 + CRUD 控制器 + 前端 JS；`-d` 删除已生成文件，核心表受保护 |
| `menu -c <控制器>` | 一键生成后台菜单 |
| `min` | 一键压缩打包前端资源 |
| `api` | 一键生成 API 文档 |
| `addon` | 插件管理（创建 / 启用 / 停用 / 打包 / 安装） |
| `install` | 一键安装初始化 |

---

## 🧩 已复刻的核心能力

- **通用 CRUD**：列表 / 新增 / 编辑 / 删除 / 批量操作 / SelectPage / 回收站 / CSV 导入
- **表格高级搜索**：`buildParams` 支持 `= <> LIKE IN BETWEEN RANGE FIND_IN_SET NULL` 等操作符 + 跨字段快速搜索
- **文件上传**：`savekey` 路径变量、`maxsize` / `mimetype` 校验、分片上传、云存储驱动（S3 兼容，零依赖 SigV4）
- **表单组件**：SelectPage / 城市选择 / 日期时间 / 开关 / 滑块 / Fieldlist / 标签输入 / selectpicker / 富文本占位
- **权限**：管理员登录、分组、规则、RBAC 守卫、数据范围限制
- **行为事件 Hook**：`module_init` / `config_init` / `upload_config_init` / `view_filter` / `admin_nologin` 等埋点
- **基础设施**：缓存、异步队列、定时任务调度、多语言、插件系统
- **辅助类**：`Date` / `Pinyin` / `Rsa` / `Http` / `Form` / `Random` 及全局函数（`cdnurl` / `xss_clean` / `letter_avatar` 等）

---

## 📖 开发文档

仓库内的项目文档：

- [`docs/USAGE.md`](docs/USAGE.md) —— **使用文档**（安装、启动、后台操作、CRUD 生成器、命令行、组件用法）
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) —— 架构与设计说明
- `docs/baseline-report.md` —— 测试基线报告
- `ts/docs/feature-audit.md` —— 功能审计
- `ts/docs/visual-smoke.md` —— 可视化冒烟清单

本项目的功能依据 **FastAdmin 官方开发文档**逐条复刻与校验。官方文档请查阅
官网 <https://doc.fastadmin.net/>（共 68 篇，覆盖安装、模块、CRUD、组件、表格、
插件、辅助类等全部主题）—— 其版权归 FastAdmin 所有，故不随本仓库分发。

---

## ⚖️ 说明与归属

- 本项目是 FastAdmin 的**学习 / 研究性质功能复刻**，与 FastAdmin 官方无隶属关系。
- FastAdmin 官方文档（<https://doc.fastadmin.net/>）版权归 FastAdmin / 深圳极速创想科技有限公司所有，本仓库不包含其副本。
- `ts/public/assets/` 下的前端资源来自 FastAdmin 及其依赖的开源库（Bootstrap / jQuery / bootstrap-table 等）。
- PHP 原版 FastAdmin 遵循其自有许可协议，未包含在本仓库内。
