/**
 * 角色库 + 攻略图缓存 每日自动同步
 *
 * 背景：#XX攻略 走 genshin 自带的 config/defSet/role/name.yaml，这张表更新滞后于
 * miao-plugin 的角色库（曾漏掉 7.2 的瓦列里）。genshin 内置的 GitCode 同步是死代码
 * 且源仓库已 404，故由荷花侧补一个定时任务。
 *
 * - 每天 05:30 自动同步，只追加缺失角色，无新增时保持安静（不产生备份）
 * - 同步后清 gsCfg 的 nameID 缓存，新角色即时生效，无需 #重载
 * - 顺带淘汰超过 TTL 的攻略图缓存（只移走本地 jpg，不联网、不改第三方源码），
 *   下次查询自然重下最新攻略图；LOTUS_STRATEGY_CACHE_TTL_DAYS=0 可关闭
 * - genshin 插件更新覆盖了 defSet 也没关系，次日会自动补回
 * - #同步角色库 供主人手动触发/验证
 */
const BasePlugin = globalThis.plugin
import { syncRoleNames, invalidateGsCfgCache } from '../services/roleNameSync/sync.js'
import { rotateStaleStrategyCache } from '../services/roleNameSync/strategyCache.js'

export class LotusRoleNameSync extends BasePlugin {
  constructor() {
    super({
      name: '[Lotus-Plugin] 角色库同步',
      dsc: '每日同步 miao 新角色并淘汰过期攻略图缓存',
      event: 'message',
      priority: 5001,
      rule: [
        { reg: '^#(同步|刷新)角色库$', fnc: 'manualSync', permission: 'master' },
      ],
    })
    this.task = {
      name: '荷花插件角色库与攻略缓存每日同步',
      cron: '0 30 5 * * ? *',
      fnc: this.runSync.bind(this),
      log: false,
    }
  }

  /** 定时执行：无变化不打日志，避免每天刷屏 */
  async runSync() {
    const r = await syncRoleNames({ apply: true })
    if (r.missing.length) {
      const ok = await invalidateGsCfgCache()
      const names = r.missing.map(m => m.list[0]).join('、')
      globalThis.logger?.mark?.(`[Lotus][角色库同步] 新增 ${r.missing.length} 个角色：${names}；缓存清理${ok ? '成功' : '失败（需 #重载）'}`)
    }

    const cache = rotateStaleStrategyCache({ apply: true })
    if (cache.rotated.length) {
      globalThis.logger?.mark?.(`[Lotus][攻略缓存] 淘汰 ${cache.rotated.length} 张超过 ${cache.ttlDays} 天的旧图，下次查询自动重下`)
    }
  }

  /** #同步角色库 —— 主人手动触发 */
  async manualSync(e) {
    const r = await syncRoleNames({ apply: true })
    const ok = r.missing.length ? await invalidateGsCfgCache() : true
    const cache = rotateStaleStrategyCache({ apply: true })

    const lines = []
    if (r.missing.length) {
      const names = r.missing.map(m => m.list[0]).join('、')
      lines.push(`角色库新增 ${r.missing.length} 个：${names}（${ok ? '已即时生效' : '需 #重载 生效'}）`)
    } else {
      lines.push('角色库已是最新')
    }
    lines.push(cache.rotated.length
      ? `已淘汰 ${cache.rotated.length} 张超过 ${cache.ttlDays} 天的旧攻略图，下次查询自动重下`
      : `攻略图缓存均在 ${cache.ttlDays} 天内，无需刷新`)
    await e.reply(lines.join('\n'), true)
    return true
  }
}
