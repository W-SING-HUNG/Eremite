# Eremite

本地优先、单用户的个人数字资料与行动管理应用。

Eremite 保存文件与链接，通过 Project、Folder 和 Tag 组织资料，并提供 Actions、Processing、Trash 和 Search。内置 Viewer 用于查看资料；File Converter 和 PDF Tools 在本机处理文件，结果经校验后保存为新资料，保留来源文件。

数据保存在本机，AI Provider 为可选配置。Eremite Host 负责 UI、策略、授权、工作区隔离、路由、校验、持久化、File Lifecycle 和 Run History；Supplier Core 只提供无界面的文件处理能力。

## 当前状态

**Current release: v1.6.1** — [正式 Release 与 release notes](https://github.com/W-SING-HUNG/Eremite/releases/tag/v1.6.1)。

- 支持 Windows x64，Node.js **>=24.15.0 <25**；推荐 **24.15.0**。
- 当前为 source-first：从源码安装依赖并运行。
- 无 Windows installer、无 hosted deployment，未发布 npm package。
- 其他平台和 Node 主版本尚未验证。

## Quick Start

安装 Git 和上述 Node.js 版本后，在 Windows PowerShell 中运行：

```powershell
git clone https://github.com/W-SING-HUNG/Eremite.git
cd Eremite
npm.cmd ci
npm.cmd run dev
```

打开 <http://127.0.0.1:3000>，首次运行设置本地密码并登录。日常启动仍使用 `npm.cmd run dev`；更换端口可用 `npm.cmd run dev -- --port 3001`。请使用项目 npm scripts 启动应用。

## 核心能力

| 能力 | 当前用途 |
| --- | --- |
| Content | 保存文件与链接，管理资料及不可变的文件版本；单文件上传上限 512 MiB。 |
| Projects / Folders / Tags | 按 Project 和任意深度 Folder 组织资料，用 Tag 跨模块分类。 |
| Actions | 管理行动、优先级、到期日、状态及来源资料。 |
| Processing | 集中处理待整理资料。 |
| Trash | 查看和恢复已移入回收站的对象；永久删除需要确认。 |
| Search | 搜索资料、行动、Project、Folder 和工具运行记录，支持范围及 Tag 筛选。 |
| Viewer | 查看 PDF、图片、TXT、Markdown、DOCX、ZIP 目录和浏览器支持的视频；DOCX 为近似排版，ZIP 不解压。TXT/Markdown 保存编辑时创建新文件版本。 |
| File Converter | 18 条受 Host allowlist 控制的图片、文档及 Office → PDF 转换。 |
| PDF Tools | PDF 合并、拆分、提取、旋转和重排页面。 |
| AI | 可选的资料问答及待确认的 Action Draft、Action update 和 Native Tool proposal。 |

## 数据与备份

SQLite 数据库、原文件和备份默认位于项目根目录的 `data/`，该目录不进入 Git。删除或更换源码目录前，请保留数据。可用 `EREMITE_DATA_DIR` 指定其他数据目录。

使用应用内“立即备份”，升级前另保存一份到设备之外。恢复须停止应用并验证备份，详见[备份与恢复](docs/backup-and-restore.md)。**不要复制运行中的 SQLite 数据库充当备份。**

测试必须使用新建的隔离数据目录和合成数据，不能连接日常真实数据。生产构建使用临时数据目录。

## 安全边界

Eremite 面向本机单用户使用。项目的 dev/start scripts 固定监听 `127.0.0.1`，禁止通过公网接口、反向代理或端口转发暴露应用。**本地密码不是 internet deployment security model。** 请保护操作系统账户、Credential Manager、数据目录和备份。

漏洞报告入口及详细规则见 [SECURITY.md](SECURITY.md)。

## AI 与隐私

AI 为可选功能。未配置 Provider 时，资料、行动和本地工具仍可使用。AI Settings 支持 OpenAI-compatible Provider，只有用户显式发起 AI 请求或 Test Connection 才向 Provider 出站连接。请求可能包含问题和 Host 允许读取的资料文字；启用前请了解服务商的数据政策。

应用内 API key 保存在 Windows Credential Manager，不存业务数据库，也不返回客户端。没有应用内 Provider profile 时，可使用完整的服务端进程环境配置：`EREMITE_AI_BASE_URL`、`EREMITE_AI_API_KEY`、`EREMITE_AI_MODEL`。模板见 [.env.example](.env.example)，真实凭据不得写入 Git、日志或公开问题报告。

AI proposal 需要用户确认。Host 在确认时重新验证提案及来源版本，再通过已有服务执行；AI 不直接写业务数据库，不自主执行工具。出站 Provider 请求不受入站 loopback 限制。

## File Converter

使用 [Eremite File Converter Core v1.1.2](https://github.com/W-SING-HUNG/Eremite-File-Converter-Core)。

当前支持 18 条已验收的转换：PNG/JPEG/WebP/AVIF 之间的 12 条图片转换，Markdown → HTML、HTML → Markdown、Markdown → DOCX，以及 DOCX/XLSX/PPTX → PDF。

- 图片转换使用 Sharp。
- 文档转换需要外部 [Pandoc >=3.1](https://pandoc.org/installing.html)。
- Office → PDF 需要外部 [LibreOffice >=7.6](https://www.libreoffice.org/download/download-libreoffice/)。

Pandoc 和 LibreOffice 不随 Eremite 捆绑。安装位置可以在 C 盘或 D 盘；对应程序必须在运行 Eremite 的进程 PATH 中可访问，修改 PATH 后重启应用。缺少某个外部引擎时，对应转换不可用。

## PDF Tools

使用 [Eremite PDF Tools Core v1.0.0-rc5](https://github.com/W-SING-HUNG/Eremite-PDF-Tools-Core)，该 Supplier 版本保留 prerelease 身份。

提供 merge、split、extract、rotate、reorder 五个操作。需要单独安装 [qpdf exactly 12.4.0](https://github.com/qpdf/qpdf/releases/tag/v12.4.0)，并将其 bin 目录加入应用进程 PATH。缺失或版本不符时，对应能力不可用。

Eremite/PDF Tools 不捆绑 qpdf 或 Microsoft VC runtime，也不自动下载或回退到内置 qpdf。

## Development

在支持的 Windows/Node.js 环境中安装依赖后运行：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run verify
npm.cmd run build
```

测试只使用 isolated data 和合成文件。涉及真实 Provider 或外部引擎的测试须按各测试的前置要求运行，并检查跳过项。开发输出为 `.next-dev/`，生产输出为 `.next/`。

生产运行时，先停止开发服务，再执行 `npm.cmd run build` 和 `npm.cmd run start`。监听地址仍为 `127.0.0.1`。

## Project structure / architecture

| 位置 | 职责 |
| --- | --- |
| `src/app/` | 页面、路由及应用服务组合。 |
| `src/modules/` | 资料、行动、项目、标签、搜索、Viewer、工具及 AI 的模块边界。 |
| `src/platform/` | SQLite、备份、文件 IO 等跨模块能力。 |
| `db/migrations/` | 数据库迁移；已发布迁移只读。 |
| `tests/` | 使用隔离数据的自动化验证。 |
| `vendor/` | Host 使用的固定版本 Supplier runtime archives。 |

Host owns **UI、policy、authorization、workspace isolation、routing、validation、persistence、File Lifecycle、Run History**。Supplier Core 只提供 headless capability；其技术注册表不赋予 Host 授权。业务模块通过公开服务交互，AI 通过 Host-owned adapters 访问上下文。

更多细节见[架构](docs/architecture.md)、[当前公共状态](docs/PUBLIC-STATE.md)和[运行及分发边界](docs/public-baseline.md)。

## Contributing

小而聚焦的改动更容易审查。环境、测试和 Host-owned policy 要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Support

普通 bug 和使用问题请通过 GitHub Issues 提交，所需信息见 [SUPPORT.md](SUPPORT.md)。

## Security

安全问题请使用 [GitHub Private Vulnerability Reporting](https://github.com/W-SING-HUNG/Eremite/security/advisories/new)，不要在 public Issues 中披露敏感细节。报告规则见 [SECURITY.md](SECURITY.md)。

## License

自有 Eremite Host 内容采用 [Apache-2.0](LICENSE)。

Copyright 2026 翁成航 (Chenghang Weng). 署名见 [NOTICE](NOTICE)。第三方依赖和 Supplier components 保留各自许可，详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
