import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { resolveCommandPath } from "./service.js"

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".flv", ".mov", ".m4v"])

const TRANSCODE_PRESETS = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"])
const DEFAULT_MAX_HEIGHT = 1080
const DEFAULT_AUDIO_KBPS = 96
const DEFAULT_MIN_VIDEO_KBPS = 150

// 十进制 MB：微信侧对“文件大小”的口径就是 1MB = 1000KB，用十进制计算才不会溢出一两 MB。
export const MB_BYTES = 1000 * 1000

export function isVideoFile(file = "") {
  return VIDEO_EXTENSIONS.has(path.extname(String(file || "")).toLowerCase())
}

export function normalizeTranscodeConfig(config = {}) {
  const source = config && typeof config === "object" ? config : {}
  return {
    enable: source.enable !== false,
    notify: source.notify !== false,
    target_mb: clampNumber(source.target_mb, 19, 1, 500),
    max_height: clampNumber(source.max_height, DEFAULT_MAX_HEIGHT, 0, 4320),
    audio_kbps: clampNumber(source.audio_kbps, DEFAULT_AUDIO_KBPS, 32, 320),
    min_video_kbps: clampNumber(source.min_video_kbps, DEFAULT_MIN_VIDEO_KBPS, 20, 20000),
    max_duration_seconds: clampNumber(source.max_duration_seconds, 1800, 0, 86400),
    preset: TRANSCODE_PRESETS.has(String(source.preset || "")) ? String(source.preset) : "veryfast",
    timeout_ms: clampNumber(source.timeout_ms, 900000, 10000, 7200000),
  }
}

export function normalizeWechatVideoLimitMb(value, fallback = 20) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return number
}

export function parseProbeJson(text = "", fallbackDuration = 0) {
  let json = null
  try {
    json = JSON.parse(String(text || ""))
  } catch {
    json = null
  }
  if (!json || typeof json !== "object") {
    return { durationSeconds: Math.max(0, Number(fallbackDuration) || 0), height: 0 }
  }

  const streams = Array.isArray(json.streams) ? json.streams : []
  const video = streams.find(item => String(item?.codec_type || "").toLowerCase() === "video") || {}
  const formatDuration = Number(json.format?.duration)
  const streamDuration = Number(video.duration)
  const duration = Number.isFinite(formatDuration) && formatDuration > 0
    ? formatDuration
    : (Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : 0)

  return {
    durationSeconds: duration > 0 ? duration : Math.max(0, Number(fallbackDuration) || 0),
    height: toPositiveInt(video.height),
  }
}

export function planTranscode({ sizeBytes = 0, durationSeconds = 0, config = {} } = {}) {
  const cfg = normalizeTranscodeConfig(config)
  if (!cfg.enable) return { ok: false, reason: "disabled" }

  const targetBytes = Math.floor(cfg.target_mb * MB_BYTES)
  const totalBytes = Math.max(0, Number(sizeBytes) || 0)
  if (totalBytes <= targetBytes) return { ok: false, reason: "already_small", targetBytes }

  const duration = Number(durationSeconds) || 0
  if (!(duration > 0)) return { ok: false, reason: "unknown_duration", targetBytes }
  if (cfg.max_duration_seconds > 0 && duration > cfg.max_duration_seconds) {
    return { ok: false, reason: "duration_too_long", targetBytes, durationSeconds: duration }
  }

  const totalKbps = (targetBytes * 8) / duration / 1000
  // 容器/音频开销留 3% 余量，避免目标码率算得太满导致产物压不进目标体积。
  const videoKbps = Math.floor((totalKbps - cfg.audio_kbps) * 0.97)
  if (videoKbps < cfg.min_video_kbps) {
    return {
      ok: false,
      reason: "bitrate_too_low",
      targetBytes,
      durationSeconds: duration,
      videoKbps,
      minVideoKbps: cfg.min_video_kbps,
    }
  }

  return {
    ok: true,
    targetBytes,
    targetMb: cfg.target_mb,
    durationSeconds: duration,
    audioKbps: cfg.audio_kbps,
    videoKbps,
    maxVideoKbps: Math.round(videoKbps * 1.45),
    bufferKbps: Math.round(videoKbps * 2.9),
  }
}

export async function probeMediaInfo(file, options = {}) {
  const ffprobePath = String(options.ffprobePath || "")
  if (!ffprobePath) return { durationSeconds: 0, height: 0 }
  const result = await runProcess(ffprobePath, [
    "-v", "error",
    "-show_entries", "stream=codec_type,height,duration",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ], {
    spawnImpl: options.spawnImpl || spawn,
    timeoutMs: Number(options.timeoutMs || 60000),
  })
  if (!result.ok) return { durationSeconds: 0, height: 0 }
  return parseProbeJson(result.stdout, options.fallbackDuration || 0)
}

export function buildTranscodeArgs({
  input,
  output,
  videoKbps,
  audioKbps,
  maxHeight = DEFAULT_MAX_HEIGHT,
  preset = "veryfast",
  sourceHeight = 0,
} = {}) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input]

  if (maxHeight > 0) {
    if (sourceHeight > 0) {
      if (sourceHeight > maxHeight) args.push("-vf", `scale=-2:${maxHeight}`)
    } else {
      // 高度未知时用表达式兜底，逗号在 filtergraph 里必须转义，否则会被当成滤镜分隔符。
      args.push("-vf", `scale=-2:'min(${maxHeight}\\,ih)'`)
    }
  }

  args.push(
    "-c:v", "libx264",
    "-preset", preset,
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-b:v", `${videoKbps}k`,
    "-maxrate", `${Math.round(videoKbps * 1.45)}k`,
    "-bufsize", `${Math.round(videoKbps * 2.9)}k`,
    "-c:a", "aac",
    "-b:a", `${audioKbps}k`,
    "-ac", "2",
    "-movflags", "+faststart",
    output,
  )
  return args
}

export async function transcodeVideoToTarget({
  input,
  config = {},
  toolsPath = "",
  onEvent = null,
  spawnImpl = spawn,
} = {}) {
  const cfg = normalizeTranscodeConfig(config)
  const source = String(input || "")
  if (!source) return { ok: false, reason: "missing_input" }
  if (!cfg.enable) return { ok: false, reason: "disabled" }

  const stat = await fs.stat(source).catch(() => null)
  if (!stat?.isFile()) return { ok: false, reason: "missing_input" }

  const ffmpegPath = await resolveCommandPath("ffmpeg", toolsPath)
  if (!ffmpegPath) return { ok: false, reason: "ffmpeg_missing" }
  const ffprobePath = await resolveCommandPath("ffprobe", toolsPath)

  const probe = ffprobePath
    ? await probeMediaInfo(source, {
        ffprobePath,
        spawnImpl,
        timeoutMs: Math.min(cfg.timeout_ms, 60000),
      })
    : { durationSeconds: 0, height: 0 }

  const plan = planTranscode({
    sizeBytes: stat.size,
    durationSeconds: probe.durationSeconds,
    config: cfg,
  })
  if (!plan.ok) {
    return {
      ...plan,
      sizeBytes: stat.size,
      sizeMb: round1(stat.size / MB_BYTES),
      durationSeconds: probe.durationSeconds,
    }
  }

  const output = `${path.join(path.dirname(source), `${path.parse(source).name}.wx${cfg.target_mb}`)}.mp4`
  await fs.rm(output, { force: true }).catch(() => null)

  let videoKbps = plan.videoKbps
  let producedSize = 0
  let detail = ""
  let attempts = 0

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt
    await emitEvent(onEvent, {
      type: "transcode-start",
      message: `视频压缩第 ${attempt} 次，目标码率 ${videoKbps} kbps（目标 ${cfg.target_mb} MB）。`,
      file: source,
    })
    const result = await runProcess(ffmpegPath, buildTranscodeArgs({
      input: source,
      output,
      videoKbps,
      audioKbps: plan.audioKbps,
      maxHeight: cfg.max_height,
      preset: cfg.preset,
      sourceHeight: probe.height,
    }), {
      spawnImpl,
      timeoutMs: cfg.timeout_ms,
    })

    if (!result.ok) {
      detail = result.detail || "ffmpeg_failed"
      producedSize = 0
      break
    }

    const outStat = await fs.stat(output).catch(() => null)
    if (!outStat?.size) {
      detail = "empty_output"
      producedSize = 0
      break
    }

    producedSize = outStat.size
    if (producedSize <= plan.targetBytes) break
    if (attempt >= 2) break

    // 一次没压够就按实测比例回推码率，再压一次（最多两次，避免长视频反复编码）。
    videoKbps = Math.max(60, Math.floor(videoKbps * (plan.targetBytes / producedSize) * 0.94))
  }

  if (!producedSize || producedSize > plan.targetBytes) {
    await fs.rm(output, { force: true }).catch(() => null)
    return {
      ok: false,
      reason: producedSize ? "still_too_large" : (detail || "ffmpeg_failed"),
      sizeBytes: producedSize,
      sizeMb: round1(producedSize / MB_BYTES),
      targetMb: cfg.target_mb,
      attempts,
      detail,
    }
  }

  await emitEvent(onEvent, {
    type: "transcode-done",
    message: `视频已压缩到 ${round1(producedSize / MB_BYTES)} MB。`,
    file: output,
  })

  return {
    ok: true,
    file: output,
    sizeBytes: producedSize,
    sizeMb: round1(producedSize / MB_BYTES),
    targetMb: cfg.target_mb,
    videoKbps,
    audioKbps: plan.audioKbps,
    durationSeconds: plan.durationSeconds,
    attempts,
  }
}

export function scheduleTempCleanup(file, delayMs = 600000) {
  const target = String(file || "")
  if (!target) return () => {}
  const timer = setTimeout(() => {
    fs.rm(target, { force: true }).catch(() => null)
  }, Math.max(1000, Number(delayMs) || 0))
  if (typeof timer.unref === "function") timer.unref()
  return () => clearTimeout(timer)
}

async function emitEvent(onEvent, event) {
  if (typeof onEvent !== "function") return
  try {
    await onEvent(event)
  } catch {
    // 回调只用于日志/提示，失败不应影响压缩主流程。
  }
}

function runProcess(command, args = [], options = {}) {
  const spawnImpl = options.spawnImpl || spawn
  return new Promise(resolve => {
    let child = null
    try {
      child = spawnImpl(command, args, { windowsHide: true })
    } catch (error) {
      resolve({ ok: false, detail: error.message })
      return
    }

    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, Math.max(1000, Number(options.timeoutMs || 900000)))
    if (typeof timer.unref === "function") timer.unref()

    child.stdout?.on("data", chunk => {
      stdout = (stdout + chunk.toString()).slice(-20000)
    })
    child.stderr?.on("data", chunk => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    child.on("error", error => {
      clearTimeout(timer)
      resolve({ ok: false, detail: error.message })
    })
    child.on("close", code => {
      clearTimeout(timer)
      const ok = code === 0 && !timedOut
      resolve({
        ok,
        code,
        timedOut,
        stdout,
        stderr,
        detail: ok ? "" : (timedOut ? "timeout" : tail(stderr || stdout, 400)),
      })
    })
  })
}

function tail(text = "", length = 400) {
  const value = String(text || "").trim()
  return value.length > length ? value.slice(-length) : value
}

function toPositiveInt(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : 0
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10
}
