import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
const BasePlugin = globalThis.plugin

import { LOTUS_INTERCEPT_PRIORITY } from "../core/intercept/priority.js"
import { loadProfile } from "../core/config/profile.js"
import { isCnServer, resolveServer } from "../core/mihoyo/regions.js"
import { getRoleUid, pickRole } from "../services/pluginBridge/common.js"
import { replyText } from "../core/transport/reply.js"
import { GenshinAbyssService } from "../services/genshinAbyss/service.js"

// 【数据捕获 · 仅主人】为「幻想真境剧诗 / 幽境危战」自制卡采集真实报文。
// 背景：本地插件（miao / genshin）对这两个端点都是空 body 直通，没有可借鉴的完整 schema，
// 盲写渲染器必翻车。先抓 need_detail=true 的原始 JSON 落盘 data/capture/，下一步照报文建卡。
// 用法：#捕获挑战数据  →  data/capture/role-combat-<uid>.json / hard-challenge-<uid>.json
export class LotusGenshinChallenge extends BasePlugin {
  constructor(options = {}) {
    super({
      name: "[Lotus-Plugin] Genshin Challenge Capture",
      dsc: "Master-only capture of genshin role_combat / hard_challenge raw payloads",
      event: "message",
      priority: LOTUS_INTERCEPT_PRIORITY,
      rule: [
        { reg: "^#捕获挑战数据$", fnc: "capture", permission: "master" },
      ],
    })
    this.service = options.service || new GenshinAbyssService(options)
    // 落盘到插件自有 data/capture/（不依赖 Yunzai cwd）
    this.captureDir = options.captureDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "capture")
  }

  async capture() {
    const userId = String(this.e.user_id)
    try {
      const profile = await loadProfile(userId, 1)
      const role = pickRole(profile, "gs")
      const uid = getRoleUid(role)
      if (!uid) return replyTextWrapper(this, "profile 1 没有同步原神 UID，无法捕获。")
      const cookie = profile?.account?.cookie
      if (!cookie) return replyTextWrapper(this, "profile 1 未保存 cookie，无法捕获。")
      const server = resolveServer({ server: role?.region, uid, game: "gs" })
      const context = {
        uid,
        server,
        isCn: isCnServer(server),
        cookie,
        profile,
        deviceFp: profile?.device?.fp || fallbackSeed(`fp:${uid}`),
        deviceId: profile?.device?.id || fallbackSeed(`id:${cookie}`),
      }

      const targets = [
        { endpoint: "role_combat", file: `role-combat-${uid}.json`, label: "幻想真境剧诗" },
        { endpoint: "hard_challenge", file: `hard-challenge-${uid}.json`, label: "幽境危战" },
      ]
      const lines = []
      await fs.mkdir(this.captureDir, { recursive: true })
      for (const target of targets) {
        try {
          const res = await this.service.requestGameRecord({ ...context, endpoint: target.endpoint })
          const file = path.join(this.captureDir, target.file)
          await fs.writeFile(file, JSON.stringify(res, null, 2))
          lines.push(`${target.label}：retcode ${res?.retcode} ${res?.message || ""} → ${file}`)
        } catch (error) {
          lines.push(`${target.label}：失败 ${error.message}`)
        }
      }
      await replyTextWrapper(this, `[荷花插件]挑战数据捕获完成\n${lines.join("\n")}`)
    } catch (error) {
      await replyTextWrapper(this, `[荷花插件]捕获失败：${error.message}`)
    }
    return true
  }
}

function replyTextWrapper(app, message) {
  return replyText(app, message)
}

function fallbackSeed(seed) {
  return crypto.createHash("md5").update(String(seed)).digest("hex")
}
