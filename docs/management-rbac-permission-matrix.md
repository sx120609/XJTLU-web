# 管理账号与权限基线

本文件是 BOSS—管理员体系的第一版权限合同。迭代 1 只建立数据基础和权限目录，不切断旧 `User.role` 权限；后续每迁移一个模块，都必须把对应路由、服务、前端入口和拒绝测试补齐。

## 身份边界

- `User`：个人账号，只参与个人中心、帖子、商品、学习资料等个人业务。
- `AdminAccount`：管理账号，只参与 `/manage` 和管理接口。
- `boss`：唯一根账号，自动拥有全部权限，包括未来新增权限。
- `admin`：由 BOSS 创建和授权的管理账号，不能创建账号、分配权限或操作 BOSS。

管理账号可以在迁移阶段通过可选关联字段映射到原个人身份，但不得复用个人密码、个人 Token、个人会话或个人业务权限。

## 可分配权限

| 权限代码 | 范围 | 说明 |
| --- | --- | --- |
| `dashboard.read` | 概览 | 查看后台概览 |
| `users.read` | 用户 | 查看个人用户 |
| `users.moderate` | 用户 | 禁言、封禁等用户治理 |
| `users.sensitive` | 用户 | AI 白名单、匿名额度等敏感操作 |
| `forum.review` | 帖子 | 帖子和回复人工审核 |
| `forum.moderate` | 帖子 | 隐藏、删除、置顶、锁定 |
| `market.review` | 市集 | 实物商品人工审核 |
| `market.governance` | 市集 | 举报、违规、申诉 |
| `market.operations` | 市集 | 类目、订单和运营数据 |
| `learning.review` | 学习资料 | 学习资料人工审核 |
| `learning.operations` | 学习资料 | 资料运营、创作者和售后 |
| `content.manage` | 内容 | 板块、公告、同步源 |
| `promotion.manage` | 商业 | 推广和商户运营 |
| `sponsor.manage` | 商业 | 赞助管理 |
| `payments.manage` | 商业 | 支付配置和支付记录 |
| `system.manage` | 系统 | 站点、功能开关和 AI 设置 |
| `storage.manage` | 系统 | 媒体和文件存储 |
| `backup.manage` | 系统 | 数据库备份与恢复 |
| `audit.read` | 系统 | 查看管理审计日志 |

以下权限只属于 BOSS，不进入普通管理员勾选列表：

- `management.accounts`
- `management.permissions`
- `management.recovery`

## 已迁移的管理入口

独立管理后台 `/api/manage` 现已覆盖：

- `content.manage`：`/boards`、`/feeds`、`/announcements` 及公告同步状态；
- `system.manage`：`/site-config`、`/features`、`/ai-review/logs`、`/system/health`、`/jwxt-agents`；
- `forum.review` / `market.review` / `learning.review`：帖子、实物商品和学习资料人工审核队列。

板块、站点配置和公告服务在本阶段只通过一个局部的兼容适配器调用旧业务函数。适配器使用固定的内部角色门槛，但不会把 `AdminAccount` 写入任何 `User` 外键；真正的操作者只写入 `ManagementAuditLog.actorId`。支付、存储、备份恢复以及需要个人用户外键的举报/订单操作仍保留在旧后台，待对应数据模型迁移后再开放给 `/manage`。

## 迁移原则

1. 先增加新模型和新权限目录，再迁移业务接口。
2. 旧 `admin/mod` 在迁移完成前继续兼容，避免后台失联。
3. 每迁移一个模块，同时修改后端授权、前端菜单和拒绝测试。
4. 最终个人 Token 不得访问管理接口，旧 `User.role=admin/mod` 不再作为管理授权来源。
