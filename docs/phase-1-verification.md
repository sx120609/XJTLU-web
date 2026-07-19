# 阶段 1：首页与导航验收记录

日期：2026-07-18

## 完成范围

- 桌面 Web、移动 Web、Flutter 原生底栏统一为：首页 / 市集 / 发布 / 广场 / 我的。
- 移动端中心发布按钮使用现有品牌色与图标体系，打开统一发布 ActionSheet。
- 新增 `/publish`、`/publish/listing`、`/publish/wanted`、`/publish/post`；原 `/market/publish` 和 `/forum` 保留兼容跳转。
- 首页 Hero 缩小，首屏先展示搜索、发布捷径和真实市集内容；后续依次为求购、学习好物、广场、校园资源、公告。
- 首页内容全部来自现有接口；无真实数据时显示空状态，不填充演示商品。
- 市集列表读取并同步 URL 筛选条件，首页分类和求购入口可直接落到目标结果。
- 全局搜索新增独立的商品 / 求购结果域，并继续复用 Cookie 可选认证。
- 未修改登录页面、登录状态、凭证加密和 SSO 流程。

## 自动化核验

- 全量单元 / 回归测试：50 / 50 通过。
- 运行时集成测试：3 / 3 通过。
- 阶段 1 专项导航、发布、首页、搜索、Flutter 源码测试：10 / 10 通过。
- 服务端 TypeScript：通过。
- Web `vue-tsc` 与 Vite 生产构建：通过，2860 个模块完成构建。
- 迁移基线空库演练：77 张表、4 段活动迁移，通过并清理临时 Schema。
- 现有市集与学习资料数据库检查：通过，无异常状态。
- 登录相关五个文件内容差异检查：通过（无内容变更）。

## 实例路由测验

使用本次生产构建启动 Vite Preview，逐一请求以下 SPA 路径，均返回 HTTP 200 且包含应用挂载点：

`/home`、`/market`、`/publish`、`/publish/listing`、`/publish/wanted`、`/square`、`/profile`、`/forum`、`/market/publish`、`/services`、`/academic`、`/jwxt`、`/schedule`。

## 环境说明

本机未安装 Flutter SDK，因此 Flutter 端执行了代码级配置回归测试，没有运行 `flutter test`。Web 生产实例、服务端接口和数据库均完成实际运行核验。

阶段 1 验收结论：通过，可以进入阶段 2。
