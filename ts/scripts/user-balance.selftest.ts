// Standalone self-test for UserBalanceService (WP8 — member balance/points
// ledger). Boots a throwaway TypeORM DataSource against the configured DB,
// exercises money()/score(), asserts the fa_user row moved and that a matching
// fa_user_money_log / fa_user_score_log row was written, then cleans up.
//
// Run:  node --import=@swc-node/register/esm-register scripts/user-balance.selftest.ts
import { DataSource } from 'typeorm'
import { loadDbConfig } from '../src/common/env.ts'
import { UserEntity } from '../src/entities/user.entity.ts'
import { UserMoneyLogEntity } from '../src/entities/user-money-log.entity.ts'
import { UserScoreLogEntity } from '../src/entities/user-score-log.entity.ts'
import { UserBalanceService } from '../src/services/user-balance.service.ts'

let pass = 0
let fail = 0
function check(label: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}`) }
}

async function main(): Promise<void> {
  const db = loadDbConfig()
  const ds = new DataSource({
    type: 'mysql',
    host: db.host,
    port: db.port,
    username: db.user,
    password: db.password,
    database: db.database,
    entities: [UserEntity, UserMoneyLogEntity, UserScoreLogEntity],
    synchronize: false,
  })
  await ds.initialize()
  const users = ds.getRepository(UserEntity)
  const moneyLogs = ds.getRepository(UserMoneyLogEntity)
  const scoreLogs = ds.getRepository(UserScoreLogEntity)
  const svc = new UserBalanceService(users, moneyLogs, scoreLogs)

  // A throwaway member to mutate.
  const now = Math.floor(Date.now() / 1000)
  const seed = users.create({
    username: `balchk_${now}`, nickname: 'balance-selftest', password: '', salt: '',
    email: `bal_${now}@x.test`, mobile: '', avatar: '', score: 0, money: 0,
    group_id: 1, status: 'normal', createtime: now, updatetime: now,
  })
  const user = await users.save(seed)
  console.log(`[setup] test user id=${user.id}`)

  try {
    // --- money() ---
    const m1 = await svc.money(10.5, user.id, 'recharge')
    check('money(+10.5) ok', m1.ok && m1.before === 0 && m1.after === 10.5)
    const m2 = await svc.money(-3.25, user.id, 'deduct')
    check('money(-3.25) ok', m2.ok && m2.before === 10.5 && m2.after === 7.25)
    const afterMoney = await users.findOneBy({ id: user.id })
    check('fa_user.money === 7.25', Number(afterMoney?.money) === 7.25)
    const mLogs = await moneyLogs.find({ where: { user_id: user.id }, order: { id: 'ASC' } })
    check('2 money-log rows written', mLogs.length === 2)
    check('money-log #1 before/after', mLogs[0]?.before === 0 && mLogs[0]?.after === 10.5 && mLogs[0]?.memo === 'recharge')
    check('money-log #2 before/after', mLogs[1]?.before === 10.5 && mLogs[1]?.after === 7.25)

    // zero amount is a documented no-op
    const m0 = await svc.money(0, user.id, 'noop')
    const mLogsAfter0 = await moneyLogs.count({ where: { user_id: user.id } })
    check('money(0) is a no-op (no extra log row)', m0.ok && mLogsAfter0 === 2)

    // --- score() ---
    const s1 = await svc.score(100, user.id, 'signin bonus')
    check('score(+100) ok', s1.ok && s1.before === 0 && s1.after === 100)
    const s2 = await svc.score(-30, user.id, 'redeem')
    check('score(-30) ok', s2.ok && s2.before === 100 && s2.after === 70)
    const afterScore = await users.findOneBy({ id: user.id })
    check('fa_user.score === 70', Number(afterScore?.score) === 70)
    const sLogs = await scoreLogs.find({ where: { user_id: user.id }, order: { id: 'ASC' } })
    check('2 score-log rows written', sLogs.length === 2)
    check('score-log #2 before/after', sLogs[1]?.before === 100 && sLogs[1]?.after === 70 && sLogs[1]?.score === -30)

    // missing user
    const bad = await svc.money(5, 999999999, 'ghost')
    check('money() on a missing user fails cleanly', !bad.ok && !!bad.error)
  } finally {
    // cleanup
    await moneyLogs.delete({ user_id: user.id })
    await scoreLogs.delete({ user_id: user.id })
    await users.delete({ id: user.id })
    await ds.destroy()
  }

  console.log(`\n[user-balance selftest] ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('[user-balance selftest] crashed:', e); process.exit(1) })
