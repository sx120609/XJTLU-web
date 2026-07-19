# 靠浦阶段 0—5 最终交付与上线手册

日期：2026-07-18

## 1. 环境与启动

要求：Node.js 18 以上（生产建议 Node 20+）、npm 9 以上、PostgreSQL 14 以上。

安装依赖：

```bash
npm install
npm run prisma:generate --prefix server
```

创建配置：Windows 可执行 `Copy-Item server/.env.example server/.env`，Linux/macOS 可执行 `cp server/.env.example server/.env`。至少正确设置：

```env
NODE_ENV=production
PORT=3011
DATABASE_URL="postgresql://用户:密码@数据库地址:5432/xjtlu_web?schema=public"
JWT_SECRET="使用独立、随机、足够长的生产密钥"
TRUST_PROXY_HOPS=0
```

Node 直接对外时 `TRUST_PROXY_HOPS=0`；只有前方恰好一层可信反向代理时设为 `1`，并由代理覆盖转发头。不要复用旧 CPU 项目的数据库、JWT 密钥或 Redis 前缀。

开发启动：

```bash
npm run dev
```

默认前端为 `http://localhost:5173`，后端为 `http://localhost:3011`，健康检查为 `http://localhost:3011/api/health`。

生产构建与启动：

```bash
npm run build
npm start
```

生产后端会提供构建后的站点静态资源。部署脚本环境可继续使用仓库现有 `deploy.sh` 和 PM2 流程。

## 2. 数据库迁移

任何生产迁移前都要先生成可恢复备份，并用 `pg_restore --list` 验证 custom-format 备份可读：

```bash
pg_dump --format=custom --file=pre-kaopu-stage5.dump "$DATABASE_URL"
pg_restore --list pre-kaopu-stage5.dump
```

全新数据库：

```bash
npm run prisma:generate --prefix server
npm run db:migrate --prefix server
npm run db:verify:baseline --prefix server
```

开发环境需要样例数据时再执行 `npm run db:seed --prefix server`。生产环境不要执行 seed。

已有数据库：

```bash
cd server
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run db:migrate
npx prisma migrate status
cd ..
```

只有目标数据库已经完整具备基线 Schema、且迁移记录与审计报告一致时，才按 [迁移基线手册](./database-migration-baseline.md) 执行 `migrate resolve`。状态不同必须先停止并比对，不能猜测标记。禁止在生产使用 `prisma migrate reset`、`db push` 或手工删除迁移记录。

当前验收基准：13 段活动迁移，空库迁移后 94 张表。

## 3. 管理员配置

管理员登录 `/admin` 后：

1. 打开“推广”页的“价格配置”，核对四类方案的名称、价格、人工成本、时长、库存上限和启用状态。
2. “推广订单”只在线下凭证或约定已经核验后点击确认；无法核验的申请填写原因后驳回。
3. “商户审核”核对服务内容、价格范围、服务区域、图片和脱敏联系方式；通过后每 90 天复核一次，通过资料不等于自动公开，商户仍需申请主页推广。
4. 退款、补偿、票据和投诉通过订单“售后留痕”登记；先在线下完成实际处理，再写入必要凭证号，系统不会自动退款或开票。
4. “市集 → 内容规则”维护禁售、版权、代写代考等规则，不要通过改代码临时放行。
5. 保持学生商品支付开关关闭、普通商品佣金为 0、免费原创价格为 0。

调价只影响后续新订单，历史订单保留申请时的价格与时长快照。关闭某个方案会阻止新申请，不会篡改历史订单。

## 4. 测试账号与测试流程

生产环境不提供或保留测试账号。开发 seed 中的 `admin/admin123` 仅限本地开发，不得带入生产；普通用户的推广申请需要真实 XJTLU 校园身份状态。

无学校登录条件时，运行自动化真实流程：

```bash
npm run test:phase5:integration --prefix server
```

测试会临时创建已验证用户、管理员、商品、求购、商户和推广订单，验证完成后全部清理，并恢复被临时修改的方案价格。

人工验收建议：

1. 通过现有 XJTLU 登录进入站点，发布一个实体商品和一条求购。
2. 在 `/market/promotions` 分别提交商品置顶、首页推广和求购加急；确认页面只生成待确认记录，不跳转自动支付。
3. 管理员在后台确认订单，检查市集、求购、首页和搜索中的“置顶/加急/推广”标签与排序。
4. 提交商户资料，管理员审核后再申请商户主页；确认公开页有“合作商户”标识、价格、范围、真实数据和举报入口。
5. 用另一个已验证账号咨询商户，确认公开接口只有脱敏联系方式，主动咨询后才返回业务联系方式。
6. 检查后台曝光和点击；同一访客同一自然日重复展示不应重复累加。
7. 完成一条普通商品意向/预订/线下确认流程，确认商品款不经过靠浦。

## 5. 发布前检查清单

- [ ] 已完成并验证 PostgreSQL 备份，记录恢复命令和负责人。
- [ ] `server/.env` 使用生产数据库、独立 JWT 密钥、正确 CORS/反向代理配置。
- [ ] 已执行 Prisma Client 生成、13 段迁移和迁移状态检查。
- [ ] `npm test --prefix server` 通过（当前基准 83/83）。
- [ ] `npm run test:integration --prefix server` 通过（当前基准 10/10）。
- [ ] `npm run build` 通过，前端生产构建无类型错误。
- [ ] `/api/health`、首页、市集、求购、广场、学习中心、校园资源和管理后台可访问。
- [ ] 移动端五项底部导航和桌面导航均正常，旧链接重定向正常。
- [ ] 普通商品支付关闭、佣金为 0、无钱包/提现/担保入口。
- [ ] 免费原创均为 0 元，付费数字学习资料无法发布。
- [ ] 四类推广均有明确标签，首页推广与自然推荐分区。
- [ ] 推广方案价格/时长已由管理员复核，不依赖源码常量。
- [ ] 推广库存、单笔人工成本、退款补偿和投诉留痕口径已复核。
- [ ] 商业展示总开关关闭时，学生交易、求购和免费学习资料仍可使用。
- [ ] 商户联系方式公开脱敏，咨询接口要求已登录且已验证身份。
- [ ] 后台可处理商品/求购审核、举报、违规、申诉、商户和推广订单。
- [ ] 生产数据库无 `phase*` 测试用户、主题、商品、求购或推广订单。
- [ ] 未运行生产 seed，未将本地 `.env`、备份或日志提交到仓库。

完整自动核验命令：

```bash
npm run verify:release
npm run market:check-db --prefix server
npm run materials:check-db --prefix server
```

## 6. 回滚方案

应用问题但数据库数据正确时：

1. 在“站点设置”关闭“推广与合作商户展示”，立即隐藏商业位并阻止新申请，不影响交易、求购和免费学习内容。
2. 回滚到上一稳定应用版本并重新构建、重启。
3. 保留阶段 5 新表和新列；旧代码不会使用这些增量字段，无需破坏性降级。
4. 验证健康检查、登录、普通商品和求购主流程。

必须回滚数据库时：

1. 立即停止应用写入并保存故障现场日志及故障后快照。
2. 将部署前 custom-format 备份恢复到一套新的空数据库，不覆盖当前故障库。
3. 核对核心表数量、用户/商品/求购/订单数量和 `_prisma_migrations`。
4. 将 `DATABASE_URL` 切换到验证后的恢复库，再启动上一稳定应用版本。
5. 保留故障库用于审计，确认恢复完成后再按运维制度处理。

不要删除已应用迁移文件，不要执行 `migrate reset`，不要通过重新启用学生商品平台支付或付费数字资料来“回滚”安全边界。

## 7. 阶段报告索引

- [阶段 0 审计](./phase-0-audit.md)
- [阶段 0.5 核验](./phase-0-5-verification.md)
- [阶段 1 核验](./phase-1-verification.md)
- [阶段 2 核验](./phase-2-verification.md)
- [阶段 3 核验](./phase-3-verification.md)
- [阶段 4 核验](./phase-4-verification.md)
- [阶段 5 核验](./phase-5-verification.md)
- [阶段 6—10 核验](./phase-6-10-verification.md)
- [商业边界与人工订单政策](./commercial-policy.md)
- [灰度发布、回滚与数据核对](./release-runbook.md)
