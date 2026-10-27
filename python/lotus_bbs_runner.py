import argparse
import json
import logging
import os
import sys
import time
import traceback
import types
import uuid
from pathlib import Path

MIHOYO_BBS_VERSION = "2.102.1"


def patch_bbstools_http():
    # MihoyoBBSTools/request.py 默认 httpx.Client(timeout=30, HTTPTransport(retries=10))，
    # 单个请求最坏 30s×11≈330s；米游社接口一旦卡顿/被限流，就会被 runner 的 180s 总超时强杀，
    # 表现为「出图慢 + 大量 180000ms 超时」（见 data/audit/checkin.jsonl 的连续超时）。
    # 这里不在上游 request.py 上加改动，而是在本 runner 进程内把 http 客户端的超时/重试收敛到合理区间：
    # 单请求上限从 ~330s 降到 ~100s，让偶发卡顿能快速失败或恢复，而不是把整个 runner 拖到被杀。
    # 可通过环境变量微调：LOTUS_BBS_HTTP_TIMEOUT（默认 25s）/ LOTUS_BBS_HTTP_RETRIES（默认 3）。
    try:
        import sys
        import httpx
        import request as _req

        timeout = float(os.environ.get("LOTUS_BBS_HTTP_TIMEOUT", "25"))
        retries = int(os.environ.get("LOTUS_BBS_HTTP_RETRIES", "3"))

        def patched_get_new_session(**kwargs):
            try:
                kw = dict(kwargs)
                kw.setdefault("timeout", timeout)
                if "transport" not in kw:
                    kw["transport"] = httpx.HTTPTransport(retries=retries)
                kw.setdefault("follow_redirects", True)
                return httpx.Client(**kw)
            except (TypeError, ModuleNotFoundError):
                import requests
                from requests.adapters import HTTPAdapter
                session = requests.Session()
                session.mount("http://", HTTPAdapter(max_retries=retries))
                session.mount("https://", HTTPAdapter(max_retries=retries))
                return session

        new_client = patched_get_new_session()
        old_http = _req.http
        old_get = _req.get_new_session
        # 修正所有 `from request import http` / `from request import get_new_session` 的模块级绑定
        # （Python 的 from-import 会复制引用，改 _req.http 不会自动跟随，必须逐个重指）。
        for mod in list(sys.modules.values()):
            if getattr(mod, "http", None) is old_http:
                mod.http = new_client
            if getattr(mod, "get_new_session", None) is old_get:
                mod.get_new_session = patched_get_new_session
        _req.http = new_client
        _req.get_new_session = patched_get_new_session
    except Exception as exc:  # 打补丁失败不应阻断签到，回退到上游默认行为
        print(f"[Lotus] patch_bbstools_http skipped: {exc}")


class LotusJsonLogHandler(logging.Handler):
    def __init__(self, event_file: str, context: dict):
        super().__init__()
        self.event_file = event_file
        self.context = context

    def emit(self, record):
        event = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "module": record.module,
            **self.context,
        }
        with open(self.event_file, "a", encoding="utf-8") as file:
            file.write(json.dumps(event, ensure_ascii=False) + "\n")


def install_json_logging(event_file: str, context: dict):
    if not event_file:
        return
    Path(event_file).parent.mkdir(parents=True, exist_ok=True)

    handler = LotusJsonLogHandler(event_file, context)
    handler.setLevel(logging.INFO)
    root = logging.getLogger()
    root.addHandler(handler)

    try:
        import loghelper
        target = getattr(loghelper, "log", None)
        if hasattr(target, "addHandler"):
            target.addHandler(handler)
    except Exception:
        pass


def write_json(path: str, data: dict):
    if not path:
        print(json.dumps(data, ensure_ascii=False))
        return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def install_captcha_bridge(captcha_dir: str, context: dict, timeout: int):
    if not captcha_dir:
        return
    Path(captcha_dir).mkdir(parents=True, exist_ok=True)

    module = types.ModuleType("captcha")

    def solve(kind: str, gt: str, challenge: str):
        request_id = f"{int(time.time() * 1000)}-{uuid.uuid4().hex}"
        request_file = Path(captcha_dir) / f"{request_id}.request.json"
        response_file = Path(captcha_dir) / f"{request_id}.response.json"
        request = {
            "id": request_id,
            "kind": kind,
            "gt": gt,
            "challenge": challenge,
            **context,
        }
        write_json(str(request_file), request)

        deadline = time.time() + timeout
        while time.time() < deadline:
            if response_file.exists():
                with open(response_file, "r", encoding="utf-8") as file:
                    response = json.load(file)
                if not response.get("ok"):
                    return None
                validate = response.get("validate") or response.get("token")
                if not validate:
                    return None
                return {
                    "challenge": response.get("challenge") or challenge,
                    "validate": validate,
                }
            time.sleep(0.5)
        return None

    module.game_captcha = lambda gt, challenge: solve("game", gt, challenge)
    module.bbs_captcha = lambda gt, challenge: solve("bbs", gt, challenge)
    sys.modules["captcha"] = module


def patch_bbstools_version(version: str):
    if not version:
        return
    import setting

    setting.mihoyobbs_version = version
    setting.headers["x-rpc-app_version"] = version
    user_agent = setting.headers.get("User-Agent", "")
    marker = "miHoYoBBS/"
    if marker in user_agent:
        user_agent = user_agent.split(marker, 1)[0].rstrip()
    setting.headers["User-Agent"] = f"{user_agent} miHoYoBBS/{version}".strip()


def run(args):
    module_dir = Path(args.module_dir).resolve()
    config_file = Path(args.config).resolve()
    sys.path.insert(0, str(module_dir))
    os.chdir(module_dir)

    context = {
        "taskId": args.task_id,
        "userId": args.user_id,
        "profileId": args.profile_id,
        "stage": "mihoyobbs",
    }

    install_json_logging(args.event_file, context)
    install_captcha_bridge(args.captcha_dir, context, args.captcha_timeout)

    import config
    patch_bbstools_version(args.mihoyobbs_version)
    import main
    patch_bbstools_http()
    from error import CookieError, StokenError

    config.config_Path = str(config_file)
    config.path = str(config_file.parent)
    config.config_prefix = ""
    config.serverless = True

    try:
        status_code, message = main.main()
        result = {
            "ok": status_code == 0,
            "statusCode": status_code,
            "message": message,
            **context,
        }
    except CookieError as error:
        result = {
            "ok": False,
            "statusCode": 1,
            "message": "账号 Cookie 出错",
            "error": str(error),
            **context,
        }
    except StokenError as error:
        result = {
            "ok": False,
            "statusCode": 1,
            "message": "账号 Stoken 出错",
            "error": str(error),
            **context,
        }
    except Exception as error:
        result = {
            "ok": False,
            "statusCode": 1,
            "message": "Lotus runner 执行失败",
            "error": str(error),
            "traceback": traceback.format_exc(),
            **context,
        }

    write_json(args.result_file, result)
    return 0 if result["ok"] else 1


def parse_args():
    parser = argparse.ArgumentParser(description="Lotus single-profile MihoyoBBSTools runner")
    parser.add_argument("--config", required=True)
    parser.add_argument("--module-dir", required=True)
    parser.add_argument("--event-file", default="")
    parser.add_argument("--result-file", default="")
    parser.add_argument("--captcha-dir", default="")
    parser.add_argument(
        "--captcha-timeout",
        type=int,
        # 打码桥最坏等待：仅在米游社真正弹出验证码、且 node 侧没写回响应时才会拖满。
        # 旧值 240s 会把这个异常分支的最坏时间放大到 runner 总超时附近；收敛到 60s
        # （可通过 LOTUS_BBS_CAPTCHA_TIMEOUT 微调），让打码异常也能快速失败，而不是拖慢整次出图。
        default=int(os.environ.get("LOTUS_BBS_CAPTCHA_TIMEOUT", "60")),
    )
    parser.add_argument("--mihoyobbs-version", default=MIHOYO_BBS_VERSION)
    parser.add_argument("--task-id", default="")
    parser.add_argument("--user-id", default="")
    parser.add_argument("--profile-id", default="")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
