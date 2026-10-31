export const CURRENT_GLOBAL_CONFIG_VERSION = 3

const ATLAS_BASE_SCOPE_ARGS = Object.freeze([
  "--game", "gi,hsr,zzz",
  "--locale", "zh",
  "--page", "gi=character,weapon,artifact,achievement/achievement,monster,tower,rolecombat,leyline",
  "--page", "hsr=character,lightcone,relicset,achievement/achievement,monster,monstervalue,EliteGroup,HardLevelGroup,InfiniteEliteGroup,maze,maze_peak,maze_boss,maze_extra",
  "--page", "zzz=character,weapon,equipment,bangboo,achievement/achievement,monster,shiyu,boss",
])

const ATLAS_CHALLENGE_SCOPE_ARGS = Object.freeze([
  "--game", "gi,hsr,zzz",
  "--locale", "zh",
  "--page", "gi=monster,tower,rolecombat,leyline",
  "--page", "hsr=monster,monstervalue,EliteGroup,HardLevelGroup,InfiniteEliteGroup,maze,maze_peak,maze_boss,maze_extra",
  "--page", "zzz=monster,shiyu,boss",
])

export const DEFAULT_GLOBAL_CONFIG = Object.freeze({
  version: CURRENT_GLOBAL_CONFIG_VERSION,
  // 上游 1aa94b2/9dbf851/a8c736c 新增：货币商店（coin shop）自动兑换 + 带鉴权 Web 管理页
  coin_shop: {
    enable: true,
    mode: "auto",
    host: "127.0.0.1",
    port: 18164,
    path: "/lotus/coin-shop",
    public_url: "",
    icp_number: "",
    session_hours: 8,
  },
  // 功能模块开关（锅巴「功能开关」）：键 = core/config/modules.js 注册表 id。
  // 缺省 / true = 启用；显式 false = 关闭（命令回复提示并吞掉）。签到链路走 scheduler.* 独立开关，不在此列。
  modules: {},
  // 命令路由（锅巴「命令路由」）：控制荷花查询类模块的拦截优先级。
  // 签到链路（体力/签到/社区签到/自动签到/扫码登录/签到设置/验证码）固定走 -Infinity，不由此处控制。
  // query_priority：查询类模块的 priority，数值越小越先；默认 5001 = 排在 miao / ZZZ / Atlas 的 5000 之后，
  //   由上游插件先接管、荷花兜底。设成负数可让荷花抢回最前。
  // front_modules：需要无视上面数值、固定抢回最前（-Infinity）的模块 id 列表，id 取 core/config/modules.js。
  routing: {
    query_priority: 5001,
    front_modules: [],
  },
  // 锅巴「快捷操作」：键 = guoba.actions.js 注册表 id。开关恒为 false 存储；
  // 锅巴保存时从 关→开 = 触发一次执行，写回前复位为 false（见 guoba.support.js）。
  // command_text：自定义指令文本（每行一条前台指令，关→开时逐条执行）。
  // command_blacklist：指令黑名单（子串匹配，命中即拒绝；设为 [] = 放行全部）。
  actions: {
    command_text: "",
    command_blacklist: ["更新图鉴", "远程"],
  },
  render: {
    background: [
      "https://api.lvxiaodong.com/api/ys?return=json",
      "https://api.horosama.com/random.php?name=genshin&type=pc&resolution=4k&format=json",
      "https://api.dreamofice.cn/hoyorandom/img?game=ys&type=json",
      "https://api.github.com/repos/Zeal-L/Honkai-Star-Rail-Wallpaper/contents/Offcial?ref=main",
      "https://api.dujin.org/pic/yuanshen/",
    ],
    theme_color: "#66ccff",
    // 配色主题（crystal 清透冰雾 / mist 云雾奶油 / saas 扁平 SaaS / ice 冰蓝毛玻璃 /
    //   aurora 赛博极光 / dawn 晨曦微光 / light 明亮通透 / glass 提亮玻璃 / dark 上游深色）
    // 全插件所有卡片共用；改这里即全局生效，入口命令无需重启参数。
    theme: "crystal",
    background_timeout_ms: 3000,
  },
  scheduler: {
    enable: true,
    plan_generate_cron: "0 0 0 * * ? *",
    run_due_cron: "0 * * * * ? *",
    mode: "fixed",
    fixed_time: "04:30",
    random: {
      window_start: "00:00",
      window_end: "23:30",
      notify_before: true,
    },
    late_registration: {
      enable: true,
      window_start: "23:30",
      window_end: "23:59",
      notify: true,
    },
    forced_disables: {
      checkin_all: false,
      genshin: false,
      honkai_sr: false,
      zzz: false,
      mihoyobbs: false,
    },
    // 自动补签：每日定时对当日签到失败条目自动重试一次。
    // 登录状态失效类失败不重试（黑名单见 services/checkin/autoResign.js）；成功才通知用户。
    auto_resign: {
      enable: true,
      cron: "0 0 12 * * ? *",
      notify_on_success: true,
    },
  },
  // 体力推送（移植自 ji-plugin note.js 的体力阈值推送）
  // 命令：#开启体力推送 [uid] / #关闭体力推送 [uid] / #体力推送阈值 <n>（可前缀 原神/星铁/绝区零）
  resin_push: {
    enable: true,
    cron: "0 */10 * * * ? *",
    cooldown_hours: 6,
    gs_threshold: 160,
    sr_threshold: 240,
    zzz_threshold: 240,
  },
  captcha: {
    providers: ["test_nine", "ttocr", "gtmanual"],
    refresh: {
      enable_on_challenge_used: true,
      max_attempts: 12,
    },
    retry: {
      provider_attempts: 3,
      chain_attempts: 2,
    },
    notify: {
      auto_recall: false,
      recall_seconds: 12,
    },
    test_nine: {
      enable: true,
      auto_start: true,
      endpoint: "http://127.0.0.1:9645/pass_uni",
      timeout_ms: 20000,
      submodule_path: "test_nine",
      venv_path: "data/python/test_nine_venv",
      model_dir: "data/test_nine/model",
      model_repo: "luguoyixiazi/model_save",
      model_files: [
        "PP-HGNetV2-B4.onnx",
        "d-fine-n.onnx",
        "yolo11n.onnx",
        "dinov3-small.onnx",
        "atten.onnx",
      ],
      install_requirements: true,
      download_models: true,
    },
    ttocr: {
      enable: false,
      api: "http://api.ttocr.com/api/recognize",
      resapi: "http://api.ttocr.com/api/results",
      key: "",
      query: "itemid=388&referer=https://webstatic.mihoyo.com/",
      poll_interval_ms: 1000,
      timeout_ms: 60000,
    },
    gtmanual: {
      enable: true,
      address: "https://gt.lotusshared.cn/",
      verify_addr: "https://gt.lotusshared.cn/GTest/register?key=114514",
      timeout_ms: 180000,
      poll_interval_ms: 1500,
    },
    vision_ai: {
      enable: false,
      api: "",
      key: "",
      timeout_ms: 60000,
    },
    // lulu / plao 外部付费 geetest 过码（移植自 ji-plugin）。token 需自行购买并注入。
    // provider 指定首选（lulu/plao），未配置 token 时该 provider 自动跳过，由其它 provider 兜底。
    lulu_plao: {
      enable: false,
      provider: "lulu",
      lulu_url: "https://api.sayu-bot.com",
      lulu_token: "",
      plao_url: "http://api.114514616.xyz",
      plao_token: "",
      timeout_ms: 15000,
    },
  },
  python: {
    mode: "venv",
    venv_path: "data/python/venv",
    system_python: "",
  },
  tools: {
    auto_install: true,
    dir: "data/tools",
    bin_dir: "data/tools/bin",
    github_api: "https://api.github.com",
    timeout_ms: 300000,
    download_retries: 3,
    bbdown: {
      enable: true,
      repo: "MOPELotus/BBDown",
      command: "BBDown",
    },
    ffmpeg: {
      enable: true,
      repo: "BtbN/FFmpeg-Builds",
      command: "ffmpeg",
    },
    aria2: {
      enable: true,
      repo: "aria2/aria2",
      command: "aria2c",
    },
  },
  remote: {
    enable: false,
    require_otp: true,
    otp_secret_env: "LOTUS_REMOTE_OTP_SECRET",
    timeout_ms: 30000,
    output_limit: 12000,
    max_download_bytes: 52428800,
    max_upload_bytes: 52428800,
    allow_overwrite_upload: false,
    restrict_file_paths: true,
    allowed_paths: ["data/remote"],
    allow_admin: false,
    shells: ["pwsh", "powershell", "cmd", "bash", "sh", "zsh"],
  },
  bilibili: {
    cookie: "",
    sessdata: "",
    search_limit: 10,
    download: {
      enable: true,
      use_aria2: true,
      tools_path: "data/tools/bin",
      resolution: 64,
      duration_limit_seconds: 3600,
      video_size_limit_mb: 100,
      video_wx_limit_mb: 20,
      video_transcode: {
        enable: true,
        notify: true,
        target_mb: 19,
        max_height: 1080,
        audio_kbps: 96,
        min_video_kbps: 150,
        max_duration_seconds: 1800,
        preset: "veryfast",
        timeout_ms: 900000,
      },
      // 大文件 HTTP 中转：超微信上限且压缩不可用时，落盘挂链接而不直发微信文件通道
      //（hook 微信发大文件有崩客户端风险）。清理随 B 站每日清理任务执行。
      video_relay: {
        enable: true,
        ttl_hours: 10 / 60, // 10 分钟：中转链接超时就失效并清理，避免占用本地存储
        max_total_size_mb: 2048,
        // 只有达到该大小（MB）才进中转；缺省 null = 回退到 video_wx_limit_mb，
        // 即「能作为视频消息直发的不中转」。配 0 = 全部进中转。
        min_size_mb: null,
      },
      max_estimated_size_mb: 0,
      multi_page_policy: "zip",
      cache_enable: true,
      cache_ttl_seconds: 0,
      timeout_ms: 600000,
      extra_args: [],
    },
  },
  douyin: {
    enable: true,
    request_timeout_ms: 15000,
    download: {
      enable: true,
      tools_path: "data/tools/bin",
      quality: "adapt",
      duration_limit_seconds: 3600,
      video_size_limit_mb: 100,
      max_estimated_size_mb: 0,
      multi_page_policy: "zip",
      timeout_ms: 600000,
    },
  },
  groups: {
    cleanup: {
      enable: true,
      dry_run: true,
      remove_group_fallback: true,
      delete_orphan_profiles: false,
      keep_if_private_possible: true,
    },
  },
  tuneweave: {
    api_url: "http://127.0.0.1:7832",
    request_timeout_ms: 30000,
  },
  netease_partner: {
    enable: false,
    schedule: "0 5 0 * * ? *",
    auto_catch_up: false,
    notify_master: true,
    login_timeout_ms: 300000,
    login_poll_ms: 3000,
    delay_ms_min: 8000,
    delay_ms_max: 11000,
    comments: ["打卡支持"],
  },
  logging: {
    retention_days: 14,
    redact_sensitive: true,
  },
  atlas: {
    data_root: "data/atlas",
    locale: "简体中文",
    max_results: 8,
    backend_root: "nanoka-atlas-backend",
    sync_after_update: true,
    sync_gallery: true,
    initial_command: "node",
    initial_args: ["src/scrape.mjs", "--mode", "full", ...ATLAS_BASE_SCOPE_ARGS],
    update_command: "node",
    update_args: ["src/scrape.mjs", "--mode", "incremental", ...ATLAS_BASE_SCOPE_ARGS],
    challenge_args: ["src/scrape.mjs", "--mode", "incremental", ...ATLAS_CHALLENGE_SCOPE_ARGS],
    version_command: "node",
    version_args: ["src/scrape.mjs", "--list-versions", "--game", "gi,hsr,zzz"],
    update_timeout_ms: 1800000,
    update_output_limit: 12000,
    auto_update: {
      enable: true,
      check_cron: "0 0 */6 * * ? *",
      challenge_cron: "0 15 */2 * * ? *",
      run_on_missing_data: true,
    },
  },
  permissions: {
    default_policy: "allow",
    users: {
      allow: [],
      deny: [],
    },
    groups: {
      allow: [],
      deny: [],
    },
    scopes: {
      "checkin.register": {
        policy: "inherit",
      },
      "checkin.refresh": {
        policy: "inherit",
      },
      "checkin.group_register": {
        policy: "master_only",
      },
      "scheduler.generate": {
        policy: "master_only",
      },
      "scheduler.run_due": {
        policy: "master_only",
      },
      "scheduler.manage": {
        policy: "master_only",
      },
      "permissions.manage": {
        policy: "master_only",
      },
      "remote.spawn": {
        policy: "master_only",
      },
      "remote.upload": {
        policy: "master_only",
      },
      "remote.download": {
        policy: "master_only",
      },
      "atlas.update": {
        policy: "master_only",
      },
      "plugin.update": {
        policy: "master_only",
      },
      "bilibili.login": {
        policy: "master_only",
      },
      "douyin.download": {
        policy: "inherit",
      },
      "bilibili.download": {
        policy: "inherit",
      },
      "tools.install": {
        policy: "master_only",
      },
      "group.members.export": {
        policy: "master_only",
      },
      "group.cleanup": {
        policy: "master_only",
      },
      "captcha.manage": {
        policy: "master_only",
      },
      "netease.partner": {
        policy: "master_only",
      },
    },
  },
})

export function createDefaultGlobalConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_GLOBAL_CONFIG))
}
