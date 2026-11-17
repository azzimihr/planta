#!/usr/bin/env python3
"""Synchronize the calendar snapshot and materialize the next 23 hours of alarms."""

import argparse
import datetime as dt
import getpass
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


FIREBASE_PATH = "calendar"
WINDOW_HOURS = 23
STATE_VERSION = 1

ROOT = Path(os.environ.get("HOME", ".")) / ".aio-calendar"
CURRENT_FILE = ROOT / "current.json"
MANIFEST_FILE = ROOT / "managed-alarms.json"
AUTH_FILE = ROOT / "auth.json"
LOCK_DIR = ROOT / ".lock"
LOG_FILE = ROOT / "termux.log"
SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_FILE = SCRIPT_DIR / "firebase-config.json"


def load_firebase_config():
    try:
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise RuntimeError(f"missing config file: {CONFIG_FILE}")
    except (OSError, ValueError) as error:
        raise RuntimeError(f"bad config file: {error}")
    api_key = config.get("apiKey")
    database_url = config.get("databaseURL")
    if not api_key or not database_url:
        raise RuntimeError("Firebase config is incomplete")
    if "REPLACE_WITH_" in str(api_key) or "REPLACE_WITH_" in str(database_url):
        raise RuntimeError("Firebase config is not set")
    return api_key, database_url.rstrip("/")


def log(message):
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    line = f"{dt.datetime.now().astimezone().isoformat(timespec='seconds')} {message}\n"
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(line)
    print(line, end="")


def atomic_write(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as error:
        log(f"cannot load {path.name}: {error}")
        return default


def canonical_hash(value):
    encoded = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_calendar(value):
    if not isinstance(value, dict) or value.get("version") != STATE_VERSION:
        raise ValueError("unsupported calendar version")
    for field in ("weekly", "dated", "templates", "overrides", "lengthOverrides"):
        if field not in value:
            value[field] = {} if field in ("templates", "overrides", "lengthOverrides") else []
    if not isinstance(value["weekly"], list) or not isinstance(value["dated"], list):
        raise ValueError("weekly and dated must be arrays")
    if not isinstance(value["templates"], dict):
        raise ValueError("templates must be an object")
    return value


def request_json(url, method="GET", body=None, headers=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def firebase_url(path, token):
    _, database_url = load_firebase_config()
    query = urllib.parse.urlencode({"auth": token})
    return f"{database_url}/{path.strip('/')}.json?{query}"


def refresh_id_token(refresh_token):
    api_key, _ = load_firebase_config()
    query = urllib.parse.urlencode({"key": api_key})
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }).encode("utf-8")
    request = urllib.request.Request(
        f"https://securetoken.googleapis.com/v1/token?{query}",
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.loads(response.read().decode("utf-8"))
    return result["id_token"], result.get("refresh_token", refresh_token)


def setup_auth():
    api_key, _ = load_firebase_config()
    email = input("Firebase email: ").strip()
    password = getpass.getpass("Firebase password: ")
    query = urllib.parse.urlencode({"key": api_key})
    body = json.dumps({
        "email": email,
        "password": password,
        "returnSecureToken": True,
    }).encode("utf-8")
    result = request_json(
        f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?{query}",
        method="POST",
        body=json.loads(body),
        headers={"Content-Type": "application/json"},
    )
    atomic_write(AUTH_FILE, {
        "refreshToken": result["refreshToken"],
        "localId": result.get("localId"),
    })
    log("Firebase refresh token saved")


def fetch_calendar():
    auth = load_json(AUTH_FILE, {})
    refresh_token = auth.get("refreshToken")
    if not refresh_token:
        raise RuntimeError(f"run --setup-auth first; missing {AUTH_FILE}")
    token, rotated = refresh_id_token(refresh_token)
    if rotated != refresh_token:
        auth["refreshToken"] = rotated
        atomic_write(AUTH_FILE, auth)
    return request_json(firebase_url(FIREBASE_PATH, token))


def save_firebase_snapshot(incoming):
    incoming = validate_calendar(incoming)
    previous = load_json(CURRENT_FILE, None)
    if previous is not None and canonical_hash(previous) == canonical_hash(incoming):
        return False

    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snapshot = ROOT / f"ca-{timestamp}.json"
    suffix = 1
    while snapshot.exists():
        snapshot = ROOT / f"ca-{timestamp}-{suffix}.json"
        suffix += 1
    atomic_write(snapshot, incoming)
    atomic_write(CURRENT_FILE, incoming)
    log(f"saved Firebase snapshot {snapshot.name}")
    return True


def parse_time(value):
    if not isinstance(value, int) or value < 0 or value >= 24 * 60:
        raise ValueError("invalid event start")
    return value


def event_occurrences(calendar, now):
    end_of_window = now + dt.timedelta(hours=WINDOW_HOURS)
    occurrences = {}
    overrides = calendar.get("overrides", {})
    weekly = calendar.get("weekly", [])
    dated = calendar.get("dated", [])
    distances = calendar.get("distances", {})
    templates = calendar.get("templates", {})

    for day_offset in range(3):
        date = (now + dt.timedelta(days=day_offset)).date()
        iso = date.isoformat()
        dow = date.isoweekday()
        disabled = set(overrides.get(iso, []))
        events = []

        for event in weekly:
            if event.get("id") in disabled or dow not in event.get("days", []):
                continue
            if not event.get("alarms", {}).get(str(dow), False):
                continue
            events.append(event)

        for event in dated:
            if event.get("date") != iso or event.get("alarm") is not True:
                continue
            events.append(event)

        events.sort(key=safe_event_start)
        previous_location = "dorm"
        for event in events:
            location = (
                templates.get(event.get("template"), {}).get("location")
                if event.get("template") in templates
                else event.get("location")
            )
            travel = distance_minutes(distances, previous_location, location)
            if location:
                previous_location = location
            add_occurrence(
                occurrences,
                event,
                iso,
                date,
                now,
                end_of_window,
                travel,
            )
    return occurrences


def distance_minutes(distances, location_a, location_b):
    if not location_a or not location_b or location_a == location_b:
        return 0
    key = "|".join(sorted((str(location_a), str(location_b))))
    value = distances.get(key, 0)
    return value if isinstance(value, int) else 0


def safe_event_start(event):
    try:
        return parse_time(event.get("start"))
    except (KeyError, TypeError, ValueError):
        return 24 * 60


def add_occurrence(target, event, iso, date, now, end_of_window, travel):
    try:
        minutes = parse_time(event["start"])
        alarm_minutes = min(minutes - 20, minutes - travel - 10)
        alarm_date = date
        if alarm_minutes < 0:
            alarm_minutes += 24 * 60
            alarm_date -= dt.timedelta(days=1)
        alarm_when = dt.datetime.combine(
            alarm_date,
            dt.time(alarm_minutes // 60, alarm_minutes % 60),
            tzinfo=now.tzinfo,
        )
    except (KeyError, TypeError, ValueError):
        return
    if not now < alarm_when <= end_of_window:
        return
    event_id = str(event["id"])
    name = str(event["name"])
    key = f"{event_id}:{iso}"
    target[key] = {
        "eventId": event_id,
        "date": iso,
        "time": alarm_when.strftime("%H:%M"),
        "label": f"c:{name}",
    }


def run_am(action, alarm):
    hour, minute = map(int, alarm["time"].split(":"))
    if action == "set":
        command = [
            "am", "start", "-a", "android.intent.action.SET_ALARM",
            "--ei", "android.intent.extra.alarm.HOUR", str(hour),
            "--ei", "android.intent.extra.alarm.MINUTES", str(minute),
            "--es", "android.intent.extra.alarm.MESSAGE", alarm["label"],
            "--ez", "android.intent.extra.alarm.SKIP_UI", "true",
        ]
    else:
        command = [
            "am", "start", "-a", "android.intent.action.DISMISS_ALARM",
            "--ei", "android.intent.extra.alarm.SEARCH_MODE", "1",
            "--es", "android.intent.extra.alarm.MESSAGE", alarm["label"],
        ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"am exited {result.returncode}")


def reconcile(calendar):
    desired = event_occurrences(calendar, dt.datetime.now().astimezone())
    managed = load_json(MANIFEST_FILE, {})
    if not isinstance(managed, dict):
        managed = {}

    for key, old in list(managed.items()):
        if key not in desired or desired[key] != old:
            run_am("dismiss", old)
            log(f"dismissed {old['label']} ({key})")
            del managed[key]

    for key, alarm in desired.items():
        if managed.get(key) == alarm:
            continue
        run_am("set", alarm)
        log(f"enabled {alarm['label']} at {alarm['date']} {alarm['time']}")
        managed[key] = alarm
    atomic_write(MANIFEST_FILE, managed)


def acquire_lock():
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        LOCK_DIR.mkdir(mode=0o700)
    except FileExistsError:
        raise RuntimeError("another calendar job is already running")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--setup-auth", action="store_true")
    args = parser.parse_args()
    acquire_lock()
    try:
        if args.setup_auth:
            setup_auth()
            return

        calendar = load_json(CURRENT_FILE, None)
        try:
            incoming = fetch_calendar()
            if incoming is not None:
                save_firebase_snapshot(incoming)
                calendar = validate_calendar(incoming)
        except (OSError, ValueError, urllib.error.URLError, RuntimeError) as error:
            log(f"Firebase unavailable; using local snapshot: {error}")

        if calendar is None:
            log("no valid local calendar snapshot; nothing to reconcile")
            return
        reconcile(validate_calendar(calendar))
    finally:
        try:
            LOCK_DIR.rmdir()
        except OSError:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"fatal: {error}")
        sys.exit(1)
