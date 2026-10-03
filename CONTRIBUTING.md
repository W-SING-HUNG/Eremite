# Contributing to Eremite

感谢对 Eremite 的关注。优先提交小而聚焦的改动；较大的行为或架构改动，请先通过
[GitHub Issues](https://github.com/W-SING-HUNG/Eremite/issues) 说明问题与方案。

## 环境与 setup

支持 Windows x64、Node.js >=24.15.0 <25，推荐 24.15.0。

```powershell
git clone https://github.com/W-SING-HUNG/Eremite.git
cd Eremite
npm.cmd ci
npm.cmd run dev
```

使用独立分支，通过 Pull Request 提交。说明问题、预期行为、兼容影响及实际运行的检查；
不要把未运行或跳过的测试写成通过。

## 测试与数据

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run verify
npm.cmd run build
```

测试只使用合成文件和新建的 isolated data；需要显式数据目录时设置 `EREMITE_DATA_DIR`。
不要把日常 `data/`、真实数据库、私人文件或备份用于测试。

runtime behavior change 必须带有覆盖该行为的测试。不要降低 validator、contracts 或 tests
来让检查通过。数据库迁移只新增，不能改写已发布迁移。

## Host-owned policy boundary

Host owns UI、policy、authorization、workspace isolation、routing、validation、persistence、
File Lifecycle 和 Run History。Supplier 技术注册表不等于 Host allowlist。
模块通过所属模块的公开服务访问业务数据；AI 只产生待确认提案，执行前由 Host 重新验证。

Supplier contract change 必须显式说明兼容影响，包括 Host adapters、输入/输出和错误处理。
贡献不能绕过授权、来源版本校验、工作区隔离或文件生命周期。

## 提交卫生

不要提交 secrets、API keys、未脱敏日志、真实数据、generated QA/temp artifacts、
缓存、依赖目录或构建产物。使用项目已有格式，避免无关格式化。

普通问题见 [SUPPORT.md](SUPPORT.md)。安全问题必须通过
[Private Vulnerability Reporting](https://github.com/W-SING-HUNG/Eremite/security/advisories/new)
私密报告，不能放入 public Issues；详见 [SECURITY.md](SECURITY.md)。
