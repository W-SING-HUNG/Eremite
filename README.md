# Eremite

Eremite 是本地优先、单用户的个人数字底座：保存文件与链接，通过 Project、Folder 和 Tag 组织资料，管理行动，在用户确认后执行内置工具或应用 AI 提案。

数据保存在本机。当前支持 **Windows x64、Node.js >=24.15.0 <25（推荐 24.15.0）**；其他平台和 Node 主版本尚未验收。当前交付形态为源码运行，需要 Node，没有 Windows installer。

## Quick Start

在获取的 Eremite 源码根目录打开 PowerShell：

Canonical source repository：[W-SING-HUNG/Eremite](https://github.com/W-SING-HUNG/Eremite)。源码版本为 **v1.6.1**，采用 source-first 交付；获取源码后从项目根目录运行下列命令。

```powershell
npm.cmd ci
npm.cmd run dev
```

打开 <http://127.0.0.1:3000>。首次运行设置本地密码，然后登录。日常启动仍使用 `npm.cmd run dev`。更换端口可用 `npm.cmd run dev -- --port 3001`。

dev/start 均固定监听 `127.0.0.1`，会拒绝其他 hostname。Eremite 面向本机使用，不是 internet-facing hosted service；不要通过代理、端口转发或公网端口暴露它。本地密码不能替代网络隔离。请使用 npm scripts，不直接执行 `next dev/start`。

## 数据与备份

SQLite 数据库、原文件和备份位于源码根目录的 `data/`，该目录不进入 Git。删除源码前请保留它。使用应用内“立即备份”，升级前另保存一份到设备之外；恢复需要停止应用并验证备份，详见 [备份与恢复](docs/backup-and-restore.md)。不要复制运行中的 SQLite 数据库充当备份。

`EREMITE_DATA_DIR` 可指定其他数据目录；隔离测试必须使用新建的临时目录。不要把日常真实数据用于测试。生产构建自动使用临时数据目录。

## 可选 AI Provider

未配置 AI 时，资料、行动和本地工具仍可使用。应用内 AI Settings 支持 OpenAI-compatible Provider；只有用户显式发起 AI 请求或 Test Connection 才调用 Provider。请求可能包含问题及 Host 允许读取的资料文字，启用前请确认服务商的数据政策。

应用内 API Key 保存在 Windows SecretStore（Credential Manager），不存数据库，也不返回客户端。只有没有应用内 Provider profile 时，才使用完整的服务端进程环境变量配置：`EREMITE_AI_BASE_URL`、`EREMITE_AI_API_KEY`、`EREMITE_AI_MODEL`。模板见 [.env.example](.env.example)；真实 Key 不得写入 Git、日志或公开问题报告。

AI 只提出待确认的 Action Draft、Action update 或 Native Tool proposal。用户确认后，Host 才执行已有服务和校验；AI 不直接写业务数据库，不自主执行工具。Provider 出站连接不受入站 loopback 限制。

## 文件工具与预览

- File Converter：18 条 Host allowlist 转换。图片由 Sharp 提供；文档转换需安装 [Pandoc](https://pandoc.org/installing.html) **>=3.1**，Office → PDF 需安装 [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) **>=7.6**。它们是可选的外部程序，不随 Host 源码捆绑。非默认安装目录（包括 D 盘）需加入 PATH 后重新启动 Eremite；未发现程序只表示当前进程无法访问对应能力。
- PDF Tools：merge、split、extract、rotate、reorder；需单独安装 [qpdf 12.4.0](https://github.com/qpdf/qpdf/releases/tag/v12.4.0) 并将其 bin 目录加入 Eremite 进程 PATH。rc5 不捆绑 qpdf、Microsoft VC Runtime，也没有 vendor fallback；缺失或版本不符时对应能力不可用。
- 每次工具执行都由 Host 校验输出，再创建新资料；来源文件保持不可变。
- Viewer 支持 PDF、图片、TXT、Markdown、DOCX、ZIP 目录和常见浏览器视频。DOCX 为近似排版；ZIP 只看目录，不解压。单文件上传上限 512 MiB。

## Development / Tests

依赖须来自当前源码自己的 `node_modules`。dev 产物为 `.next-dev/`，production 产物为 `.next/`。

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run verify
```

生产模式：先停止开发服务，再运行 `npm.cmd run build` 和 `npm.cmd run start`。验证监听可运行 `npm.cmd run test:loopback:http`（需先 build）。真实 Provider、外部转换引擎及独立浏览器验收是单独门禁，普通测试 PASS 不代表已完成公开发布验收。

架构见 [architecture](docs/architecture.md)，当前能力和限制见 [PUBLIC-STATE](docs/PUBLIC-STATE.md)，工程变更遵循 [AGENTS.md](AGENTS.md)。

## 发布状态、安全与许可

源码版本为 **v1.6.1**，当前交付为 source-first，需要 Node.js，没有 Windows installer。File Converter **1.1.2**、PDF Tools **1.0.0-rc5（prerelease）** 和 Host integration 已完成独立技术验收。版本号描述源码身份；tag、GitHub Release 和安全报告渠道分别经过自己的发布门禁。`private: true` 用于防止意外 npm publication；源码仓库信息见 [finalization checklist](docs/public-baseline.md)。

GitHub Private Vulnerability Reporting 已启用，漏洞报告规则和本仓私密报告入口见 [SECURITY.md](SECURITY.md)。不要在公开 Issues 中披露敏感漏洞细节。

自有 Eremite Host 内容采用 [Apache License 2.0](LICENSE)。Copyright 2026 翁成航 (Chenghang Weng). 正式署名见 [NOTICE](NOTICE)。第三方依赖、Supplier artifacts 和原生组件遵循各自许可，根 LICENSE 不重新授权它们。第三方清单及待办见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
