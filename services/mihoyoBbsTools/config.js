import { createDefaultProfile } from "../../core/config/profile.js"

export function buildBbsToolsConfig(profile, options = {}) {
  const base = createBbsToolsDefaultConfig()
  const account = profile?.account || {}
  const device = profile?.device || {}
  const mihoyobbs = profile?.mihoyobbs || {}
  const games = profile?.games || {}
  const cloudGames = profile?.cloud_games || {}
  // 全局覆盖（config/global.yaml 的 checkin.bbs）：用于「不改每个用户 profile」就能统一关掉
  // 某个任务或收窄板块。典型用途见 services/mihoyoBbsTools/config.js 里 like 的注释。
  const bbsOverride = options.bbs || {}
  const checkinList = normalizeCheckinList(bbsOverride.checkin_list)

  return mergeConfig(base, {
    account: {
      cookie: account.cookie || "",
      stuid: account.stuid || "",
      stoken: account.stoken || "",
      mid: account.mid || "",
    },
    device: {
      name: device.name || base.device.name,
      model: device.model || base.device.model,
      id: device.id || "",
      fp: device.fp || "",
    },
    mihoyobbs: {
      enable: pickBoolean(bbsOverride.enable, Boolean(mihoyobbs.enable)),
      checkin: pickBoolean(bbsOverride.checkin, Boolean(mihoyobbs.tasks?.checkin ?? mihoyobbs.checkin)),
      checkin_list: checkinList || mihoyobbs.checkin_list || base.mihoyobbs.checkin_list,
      read: pickBoolean(bbsOverride.read, Boolean(mihoyobbs.tasks?.read ?? mihoyobbs.read)),
      // 点赞（like / cancel_like）长期被米游社风控挡死：接口固定返回
      // {"data":null,"message":"invalid request","retcode":-10001}，上游每板块还要做
      // 30s/15s/6s 的退避重试，实测单次签到里有 100s+ 全耗在这上面（线上 18/18 全失败）。
      // 米游币在「签到 + 阅读 + 分享」就到 50 上限，点赞失败并不影响收益，所以默认关掉。
      like: pickBoolean(bbsOverride.like, Boolean(mihoyobbs.tasks?.like ?? mihoyobbs.like)),
      cancel_like: pickBoolean(bbsOverride.cancel_like, Boolean(mihoyobbs.tasks?.cancel_like ?? mihoyobbs.cancel_like)),
      share: pickBoolean(bbsOverride.share, Boolean(mihoyobbs.tasks?.share ?? mihoyobbs.share)),
    },
    games: {
      cn: {
        enable: Boolean(games.cn?.enable),
        useragent: buildUserAgent(profile),
        genshin: normalizeGameSwitch(games.cn?.genshin),
        honkai2: normalizeGameSwitch(games.cn?.honkai2),
        honkai3rd: normalizeGameSwitch(games.cn?.honkai3rd),
        tears_of_themis: normalizeGameSwitch(games.cn?.tears_of_themis),
        honkai_sr: normalizeGameSwitch(games.cn?.honkai_sr),
        zzz: normalizeGameSwitch(games.cn?.zzz),
        hna: normalizeGameSwitch(games.cn?.hna),
      },
      os: {
        enable: Boolean(games.os?.enable),
        cookie: games.os?.cookie || "",
        lang: games.os?.lang || "zh-cn",
        genshin: normalizeGameSwitch(games.os?.genshin),
        honkai3rd: normalizeGameSwitch(games.os?.honkai3rd),
        tears_of_themis: normalizeGameSwitch(games.os?.tears_of_themis),
        honkai_sr: normalizeGameSwitch(games.os?.honkai_sr),
        zzz: normalizeGameSwitch(games.os?.zzz),
      },
    },
    cloud_games: {
      cn: {
        enable: Boolean(cloudGames.cn?.genshin?.enable || cloudGames.cn?.zzz?.enable),
        genshin: {
          enable: Boolean(cloudGames.cn?.genshin?.enable),
          token: cloudGames.cn?.genshin?.token || "",
        },
        zzz: {
          enable: Boolean(cloudGames.cn?.zzz?.enable),
          token: cloudGames.cn?.zzz?.token || "",
        },
      },
    },
  })
}

export function createBbsToolsDefaultConfig() {
  const profile = createDefaultProfile({ qq: "0" })
  return {
    enable: true,
    version: 15,
    push: "",
    account: {
      cookie: "",
      stuid: "",
      stoken: "",
      mid: "",
    },
    device: {
      name: "Xiaomi MI 6",
      model: "Mi 6",
      id: "",
      fp: "",
    },
    mihoyobbs: {
      enable: false,
      checkin: false,
      checkin_list: profile.mihoyobbs.checkin_list,
      read: true,
      like: true,
      cancel_like: true,
      share: true,
    },
    games: {
      cn: {
        enable: true,
        useragent: buildUserAgent(profile),
        retries: 3,
        genshin: { checkin: true, black_list: [] },
        honkai2: { checkin: false, black_list: [] },
        honkai3rd: { checkin: false, black_list: [] },
        tears_of_themis: { checkin: false, black_list: [] },
        honkai_sr: { checkin: true, black_list: [] },
        zzz: { checkin: true, black_list: [] },
      },
      os: {
        enable: false,
        cookie: "",
        lang: "zh-cn",
        genshin: { checkin: false, black_list: [] },
        honkai3rd: { checkin: false, black_list: [] },
        tears_of_themis: { checkin: false, black_list: [] },
        honkai_sr: { checkin: false, black_list: [] },
        zzz: { checkin: false, black_list: [] },
      },
    },
    cloud_games: {
      cn: {
        enable: false,
        genshin: { enable: false, token: "" },
        zzz: { enable: false, token: "" },
      },
      os: {
        enable: false,
        lang: "zh-cn",
        genshin: { enable: false, token: "" },
      },
    },
    competition: {
      enable: false,
      genius_invokation: { enable: false, account: [], checkin: false, weekly: false },
    },
    web_activity: {
      enable: false,
      activities: [],
    },
  }
}

export function buildUserAgent(profile) {
  const custom = profile?.games?.cn?.useragent || profile?.games?.cn?.custom_useragent
  if (custom && profile?.games?.cn?.ua_mode === "custom") return custom
  const device = profile?.device || {}
  const android = device.android_version || "12"
  const model = device.model || "Unspecified Device"
  return `Mozilla/5.0 (Linux; Android ${android}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36`
}

function normalizeGameSwitch(value = {}) {
  return {
    checkin: Boolean(value.checkin),
    black_list: Array.isArray(value.black_list) ? value.black_list : [],
  }
}

// 全局覆盖只认布尔真值：yaml 里留空 / 写 null 一律视为「沿用用户 profile」，
// 避免运维误把空值当成 false 把任务全关掉。
function pickBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback
}

// 板块 id 列表：非空数组才生效，元素转数字并去重，乱七八糟的值直接丢弃。
function normalizeCheckinList(value) {
  if (!Array.isArray(value)) return null
  const ids = [...new Set(value
    .map(item => Number(item))
    .filter(item => Number.isInteger(item) && item > 0))]
  return ids.length ? ids : null
}

function mergeConfig(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch ?? base
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in base ? mergeConfig(base[key], value) : value
  }
  return result
}

function isPlainObject(value) {
  return value && typeof value === "object" && value.constructor === Object
}
