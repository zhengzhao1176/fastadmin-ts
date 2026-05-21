# fastadmin-ts 使用文档

本文档介绍如何安装、运行并使用 fastadmin-ts —— 从环境准备、启动后台，到用代码生成器开发一个完整业务模块。

> 配套文档：项目概览见 [`README.md`](../README.md)，架构设计见 [`ARCHITECTURE.md`](ARCHITECTURE.md)，FastAdmin 官方开发文档镜像见 `doc/` 目录。

---

## 目录

1. [环境准备](#1-环境准备)
2. [安装与启动](#2-安装与启动)
3. [登录后台](#3-登录后台)
4. [后台功能使用](#4-后台功能使用)
5. [用 CRUD 生成器开发一个模块](#5-用-crud-生成器开发一个模块)
6. [命令行工具 bin/think](#6-命令行工具-binthink)
7. [表单组件](#7-表单组件)
8. [表格与高级搜索](#8-表格与高级搜索)
9. [文件上传](#9-文件上传)
10. [多语言](#10-多语言)
11. [运行测试](#11-运行测试)
12. [常见问题](#12-常见问题)

---

## 1. 环境准备

| 依赖 | 版本 / 说明 |
|------|------|
| Node.js | ≥ 20 |
| MySQL | 5.7 / 8.x |
| Redis | 可选；未提供时缓存与队列自动降级为内存实现 |
| Docker | 可选；用于一键拉起 MySQL / Redis 测试栈 |

---

## 2. 安装与启动

```bash
# 1) 安装依赖（根目录是测试套件，ts/ 是应用本体）
npm install
cd ts && npm install && cd ..

# 2) 配置环境变量
cp .env.test.example .env.test
#   按需修改 .env.test 中的 DB_* / REDIS_* 连接信息

# 3) 启动 MySQL / Redis
#    方式 A — Docker（推荐）
cd docker && docker compose up -d && cd ..
#    方式 B — 使用本机已有的 MySQL / Redis，跳过此步，直接改 .env.test

# 4) 初始化数据库（建库、导入结构、写入种子数据）
npm run db:reset

# 5) 启动 TS 服务
cd ts && PORT=8888 npm start
```

启动成功后控制台输出：

```
[fastadmin-ts] listening on http://127.0.0.1:8888
```

> 服务通过 `@swc-node/register` 直接运行 TypeScript，无需预编译。修改源码后重启进程即可生效。

---

## 3. 登录后台

浏览器打开：

```
http://127.0.0.1:8888/admin.php/index/login
```

默认管理员账号（种子数据）：

| 用户名 | 密码 |
|--------|------|
| `admin` | `123456` |

登录后进入仪表盘 `/admin.php/index/index`，左侧为菜单栏，顶部为多标签导航。

---

## 4. 后台功能使用

### 4.1 仪表盘

`/admin.php/index/index` —— AdminLTE 外壳 + 统计卡片 + 注册趋势图。

### 4.2 列表页通用操作

每个业务模块的列表页（如 `/admin.php/test/index`）顶部都有统一工具栏：

| 按钮 | 作用 |
|------|------|
| **添加** | 弹出新增表单 |
| **编辑** | 勾选一行后编辑（也可点行内「编辑」按钮） |
| **删除** | 勾选后删除；表含 `deletetime` 列时为软删除（进回收站） |
| **禁用 / 启用** | 批量改 `status` 字段 |
| **导入** | 上传 CSV 批量导入 |
| **回收站** | 进入回收站页面 |

表格本体支持：分页、列排序、搜索框（跨字段模糊）、每页条数切换。

### 4.3 回收站

软删除（表有 `deletetime` 列）的数据进入回收站。在列表页点「回收站」进入 `/admin.php/<模块>/recyclebin`：

- **行内「还原」** —— 单行还原回列表
- **行内「销毁」** —— 单行彻底删除（弹确认框）
- **工具栏「全部还原」** —— 还原回收站全部数据
- **工具栏「清空回收站」** —— 彻底清空（弹确认框）

### 4.4 CSV 导入

1. 准备一个 CSV 文件，**首行为表头**。
2. 表头可用列的**注释**（如「标题」）或**字段名**（如 `title`），两者都能被识别。
3. 列表页点「导入」→ 选择 CSV → 自动上传并批量插入。

示例 CSV：

```csv
title,week,status,views
第一篇,monday,normal,10
第二篇,tuesday,hidden,20
```

> 主键、`createtime` / `updatetime` / `deletetime` 列会被忽略（自增 / 自动写入）。

### 4.5 常规管理

| 页面 | 路径 | 用途 |
|------|------|------|
| 系统配置 | `/admin.php/general/config` | 站点名称、上传、字典等配置项 |
| 附件管理 | `/admin.php/general/attachment` | 上传记录的浏览与管理 |
| 个人资料 | `/admin.php/general/profile` | 修改昵称、头像、密码 |

### 4.6 权限管理

| 页面 | 路径 |
|------|------|
| 管理员 | `/admin.php/auth/admin` |
| 角色组 | `/admin.php/auth/group` |
| 菜单规则 | `/admin.php/auth/rule` |

权限模型：管理员属于角色组，角色组绑定菜单规则（`auth_rule`），访问受 `AdminAuthGuard` 校验。

### 4.7 后台换肤 / 布局

点顶部右侧齿轮图标，打开右侧控制栏，可切换 18 种皮肤、多级导航、多标签等，选择会写入 Cookie 持久化。

---

## 5. 用 CRUD 生成器开发一个模块

这是最常用的开发流程 —— 由一张数据库表一键生成完整的增删改查模块。以 `fa_article`（文章表）为例：

### 第 1 步：建表

按 FastAdmin 字段约定建表，生成器会据此自动选择表单控件：

```sql
CREATE TABLE `fa_article` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `category_id` int unsigned DEFAULT 0 COMMENT '分类ID',
  `title` varchar(100) DEFAULT '' COMMENT '标题',
  `content` text COMMENT '内容',
  `image` varchar(255) DEFAULT '' COMMENT '封面',
  `flag` varchar(30) DEFAULT '' COMMENT '标志:hot=热门,index=首页,recommend=推荐',
  `views` int unsigned DEFAULT 0 COMMENT '点击量',
  `status` enum('normal','hidden') DEFAULT 'normal' COMMENT '状态',
  `weigh` int DEFAULT 0 COMMENT '权重',
  `createtime` bigint DEFAULT NULL COMMENT '创建时间',
  `updatetime` bigint DEFAULT NULL COMMENT '更新时间',
  `deletetime` bigint DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

字段约定（生成器自动识别）：

| 字段特征 | 生成的控件 |
|----------|-----------|
| `*_id` / `*_ids` | SelectPage 动态下拉 |
| `enum` / `set` / 注释含 `key=value` 选项 | selectpicker 下拉（注释自动解析为中文选项） |
| `*image(s)` / `*file` | 文件上传组件 |
| `date` / `datetime` / `*time` | 日期时间选择器 |
| `*range` | 日期时间区间 |
| `tinyint` / `switch` | 开关组件 |
| `*tags` | 标签输入 |
| `array` / `json` / `*json` | Fieldlist 键值编辑器 |
| `content` 文本列 | 富文本编辑器占位 |
| `text` 列 | 多行文本框 |
| 非空且无默认值的列 | 自动加 `data-rule="required"` 校验 |
| 表含 `deletetime` 列 | 自动生成回收站路由与页面 |

### 第 2 步：生成代码

```bash
cd ts
./bin/think crud -t fa_article
```

生成三个文件：

```
✅ src/entities/article.entity.ts          TypeORM 实体
✅ src/modules/admin/article.controller.ts CRUD 控制器（含回收站 / 导入）
✅ public/assets/js/backend/article.js      前端 AMD 模块
```

> 已存在时加 `-f` 覆盖；`./bin/think crud -t fa_article -d` 删除已生成的文件。
> 核心表（`fa_admin` / `fa_user` / `fa_auth_rule` 等）受保护，会被拒绝生成。

### 第 3 步：注册到模块

编辑 `src/app.module.ts`，把实体加入 `entities` 数组：

```ts
import { ArticleEntity } from './entities/article.entity.ts'
// entities: [ ..., ArticleEntity ]
```

编辑 `src/modules/admin/admin.module.ts`：

```ts
import { ArticleController } from './article.controller.ts'
// TypeOrmModule.forFeature([ ..., ArticleEntity ])
// controllers: [ ..., ArticleController ]
```

### 第 4 步：生成菜单（可选）

```bash
./bin/think menu -c article
```

在 `auth_rule` 表插入该模块的菜单节点，登录后即可在左侧看到。

### 第 5 步：重启并访问

```bash
PORT=8888 npm start
```

打开 `http://127.0.0.1:8888/admin.php/article/index` —— 列表、新增、编辑、删除、批量操作、搜索、回收站、CSV 导入全部开箱可用。

---

## 6. 命令行工具 bin/think

在 `ts/` 目录下执行。复刻自 PHP 的 `php think`：

```bash
./bin/think --help            # 查看全部命令

./bin/think crud   -t fa_article [-f] [-d]   # 生成 / 覆盖 / 删除 CRUD
./bin/think menu   -c article [-d] [-f]      # 生成 / 删除后台菜单
./bin/think min    -m all -r all             # 压缩打包前端资源
./bin/think api    -o api.html               # 生成 API 文档
./bin/think addon  --action create --name demo   # 插件：创建/启用/停用/打包/安装
./bin/think install ...                      # 一键安装初始化
```

---

## 7. 表单组件

新增 / 编辑表单中各类控件的用法（生成器按字段约定自动产出，也可在自定义表单中手写）：

| 组件 | 触发方式 | 文档 |
|------|----------|------|
| SelectPage 动态下拉 | `class="selectpage" data-source="<模块>/selectpage"` | `doc/178.html` |
| 城市选择 | `data-toggle="city-picker"` | `doc/180.html` |
| 日期时间 | `class="datetimepicker"` | `doc/181.html` |
| 日期区间 | `class="datetimerange"` | `doc/736.html` |
| selectpicker 下拉 | `class="selectpicker"` | `doc/182.html` |
| 开关 | `data-toggle="switcher"` | `doc/185.html` |
| 滑块 | `class="slider" data-slider-min/max/step` | `doc/186.html` |
| Fieldlist 键值编辑 | `<dl class="fieldlist" data-name="row[json]">` | `doc/184.html` |
| 标签输入 | `data-role="tagsinput"` | `doc/1207.html` |
| 自动完成 | `data-role="autocomplete"` | `doc/1206.html` |
| 文件上传 | `class="faupload"` / `class="fachoose"` | `doc/177.html` `doc/183.html` |
| 表单验证 | `data-rule="required;email;..."` | `doc/179.html` |

服务端 `Form` 辅助类（`ts/src/common/form.ts`）也可在代码里生成上述控件的 HTML，例如
`Form.selectpicker('status', {normal:'正常', hidden:'隐藏'}, 'normal')`。

---

## 8. 表格与高级搜索

列表数据由 bootstrap-table 渲染，服务端 `buildParams()` 翻译查询参数：

- **快速搜索** —— 搜索框输入，跨配置的 `searchFields` 做 OR 模糊匹配。
- **高级搜索** —— 按列条件过滤，支持操作符：

| 操作符 | 含义 |
|--------|------|
| `=` `<>` | 等于 / 不等于 |
| `LIKE` `NOT LIKE` | 模糊匹配 |
| `>` `>=` `<` `<=` | 比较 |
| `IN` `NOT IN` | 集合 |
| `BETWEEN` `NOT BETWEEN` | 区间（支持单边开放） |
| `RANGE` `NOT RANGE` | 日期时间区间 |
| `FIND_IN_SET` | 在逗号集合中查找（`set` / 多选字段） |
| `NULL` `NOT NULL` | 空值判断 |

---

## 9. 文件上传

上传接口：`POST /admin.php/ajax/upload`。可通过环境变量配置（见 `.env.test.example`）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `UPLOAD_SAVEKEY` | `/uploads/{year}{mon}{day}/{filemd5}{.suffix}` | 保存路径模板 |
| `UPLOAD_MAXSIZE` | `10mb` | 单文件大小上限 |
| `UPLOAD_MIMETYPE` | `*` | 允许的后缀 / mimetype 白名单 |
| `UPLOAD_CHUNKING` | `true` | 是否允许分片上传 |

`savekey` 支持变量：`{year}{mon}{day}{hour}{min}{sec}{random}{random32}{filename}{suffix}{.suffix}{filemd5}`。

云存储：设置 `STORAGE_DRIVER=s3` 及 `STORAGE_S3_*` 后，上传走 S3 兼容对象存储。

---

## 10. 多语言

语言包位于 `ts/lang/<语言>/<模块>/<控制器>.json`，内置 `zh-cn` 与 `en`。

- 切换：URL 加 `?lang=en`，或设置 `lang` Cookie。
- 模板中用 `{{ __('Key') }}`，支持 `{{ __('Hi %s', 'name') }}` 占位。

---

## 11. 运行测试

```bash
# 根目录：全量黑盒 + 单元测试
npm test                       # 645 通过 / 100 跳过

# ts/ 目录：冒烟测试与类型检查
cd ts
PORT=8888 npm run smoke         # 25 项主链路冒烟
npm run typecheck               # 类型检查
```

> 完整黑盒对照测试默认指向 PHP 原版（`FASTADMIN_BASE_URL`）。纯函数单元测试（`tests/cross-cutting/*`）无需任何服务即可运行。

---

## 12. 常见问题

**Q：启动报数据库连接失败？**
A：确认 MySQL 已启动，且 `.env.test` 的 `DB_*` 与实际一致；首次需先 `npm run db:reset`。

**Q：后台页面样式 / JS 错乱？**
A：前端资源在 `ts/public/assets/`，已随仓库提交。确认服务正常托管 `/assets/` 静态目录。

**Q：生成的 CRUD 模块访问 404？**
A：检查是否已完成「第 3 步：注册到模块」（`app.module.ts` 与 `admin.module.ts`），并重启了服务。

**Q：回收站 / 导入按钮没出现？**
A：回收站需表含 `deletetime` 列；两者均由 CRUD 生成器自动产出，手写控制器需自行调用 `renderListPage` 时传入 `recyclebinUrl` / `importUrl`。

**Q：没有 Redis 能跑吗？**
A：能。缓存与队列在无 Redis 时自动降级为内存实现。

**Q：分片上传没生效？**
A：确认 `UPLOAD_CHUNKING` 未被设为 `false`；分片上传同时需要前端 dropzone 配合。

---

如需了解某个功能的完整规格，可查阅 `doc/` 目录下的 FastAdmin 官方文档镜像：

```bash
cd doc && python3 -m http.server 9100
# 浏览器打开 http://127.0.0.1:9100/index.html
```
