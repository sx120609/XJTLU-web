# 历史迁移归档

这里保留阶段 0 审计时发现的 63 段旧迁移，供审计、数据追溯和人工恢复参考。

这些文件不再由 `prisma migrate deploy` 自动执行，原因是：

- 现有 PostgreSQL 数据库只登记了其中 2 段迁移；
- 早期迁移包含 SQLite 风格 SQL，不能安全地在 PostgreSQL 空库顺序回放；
- 项目此前主要依赖 `prisma db push`，迁移历史与真实 Schema 已经分叉。

新的可部署迁移位于 `prisma/migrations`：两段已登记名称的兼容标记、一份当前 PostgreSQL Schema 基线，以及基线之后的小步增量迁移。

不要把本目录直接改名回 `migrations`，也不要在生产数据库上逐段补跑。现有数据库接入新基线前，必须按 `docs/database-migration-baseline.md` 备份并标记基线。
