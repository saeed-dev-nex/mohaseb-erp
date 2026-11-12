"""In-app update awareness and approval (superuser-driven updates).

Historically the launchers ran update_project.ps1 at every start, so a
new version landed silently whenever the app restarted. Now the
updater only applies an update that carries the approval flag written
here, and this module lets the superuser see — before anything is
installed — that an update exists and what it changes (parsed from the
remote branch's CHANGELOG.md), then approve it at a quiet moment.

All git work is read-only except ``fetch``. Results are cached in a
small JSON file next to the backend (gitignored) so the layout banner
can poll cheaply; a forced check always fetches.
"""

import json
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

CACHE_FILENAME = '.update_status_cache.json'
FLAG_FILENAME = 'update-approved.flag'
CACHE_MAX_AGE = timedelta(hours=6)
GIT_TIMEOUT = 30


def repo_root():
    return Path(settings.BASE_DIR).parent


_GIT_EXECUTABLE = None


def _windows_git_candidates():
    """Well-known Git for Windows install locations (PATH fallback)."""
    candidates = []
    for env_name in ('ProgramFiles', 'ProgramFiles(x86)'):
        base = os.environ.get(env_name)
        if base:
            candidates.append(str(Path(base) / 'Git' / 'cmd' / 'git.exe'))
            candidates.append(str(Path(base) / 'Git' / 'bin' / 'git.exe'))
    local = os.environ.get('LOCALAPPDATA')
    if local:
        candidates.append(str(Path(local) / 'Programs' / 'Git' / 'cmd' / 'git.exe'))
        candidates.append(str(Path(local) / 'Git' / 'cmd' / 'git.exe'))
    return candidates


def _git_executable():
    """Resolve git even when the server process's PATH does not have it.

    The update check runs inside the server process, whose environment
    can differ from the interactive shell where the launcher's own
    updater works (a restricted PATH, a different Windows account, an
    autostart context). Relying on PATH alone made the status check
    fail on a real install, so on Windows the standard Git install
    locations are probed as a fallback.
    """
    global _GIT_EXECUTABLE
    if _GIT_EXECUTABLE is not None:
        return _GIT_EXECUTABLE
    found = shutil.which('git')
    if not found:
        for candidate in _windows_git_candidates():
            if Path(candidate).is_file():
                found = candidate
                break
    _GIT_EXECUTABLE = found or 'git'
    return _GIT_EXECUTABLE


def _run_git(args, timeout=GIT_TIMEOUT):
    root = str(repo_root())
    # safe.directory: when the server runs under a different Windows
    # account than the user who owns the clone, git refuses every
    # command with "detected dubious ownership" — scope trust to this
    # repo only. GIT_TERMINAL_PROMPT=0 keeps a credential prompt from
    # ever hanging the request; the fetch then fails fast and handled.
    command = [_git_executable(), '-c', f'safe.directory={root}', '-C', root, *args]
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0'}
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            # Decode as UTF-8 explicitly: with text=True alone, Windows
            # decodes git's output with the locale code page (cp1252),
            # and the Persian CHANGELOG's UTF-8 bytes kill the reader
            # thread — subprocess then returns stdout=None and the
            # status check died with AttributeError (the real cause of
            # the 500 on a live install, confirmed by its traceback).
            encoding='utf-8',
            errors='replace',
            timeout=timeout,
            env=env,
        )
    except FileNotFoundError:
        # git is not reachable from the server process at all — turn
        # it into a handled failure instead of a 500.
        raise RuntimeError('git در دسترس نیست (در PATH پروسهٔ سرور پیدا نشد)')
    except PermissionError:
        raise RuntimeError('اجازهٔ اجرای git داده نشد')
    if completed.returncode != 0:
        raise RuntimeError(
            (completed.stderr or completed.stdout or 'git error').strip()
        )
    return (completed.stdout or '').strip()


def _read_version(root):
    try:
        return (root / 'VERSION').read_text(encoding='utf-8').strip()
    except OSError:
        return ''


def _version_tuple(text):
    match = re.match(r'(\d+)\.(\d+)\.(\d+)', (text or '').strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def parse_changelog_sections(text):
    """Split CHANGELOG.md into [{version, items}] in file order.

    Items are the top-level ``- `` bullets of each ``## [x.y.z]`` /
    ``## [Unreleased]`` section, with markdown emphasis stripped.
    """
    sections = []
    current = None
    for line in (text or '').splitlines():
        heading = re.match(r'##\s+\[([^\]]+)\]', line)
        if heading:
            current = {'version': heading.group(1).strip(), 'items': []}
            sections.append(current)
            continue
        if current is None:
            continue
        if line.startswith('- '):
            item = line[2:].strip().replace('**', '')
            if item:
                current['items'].append(item)
        elif line.startswith('  ') and line.strip() and current['items']:
            # Wrapped continuation of the previous bullet (the repo's
            # changelog style) — fold it into that item.
            current['items'][-1] += ' ' + line.strip().replace('**', '')
    return [section for section in sections if section['items']]


def changes_since(changelog_text, current_version):
    """Sections newer than ``current_version`` (Unreleased counts as newest)."""
    current_tuple = _version_tuple(current_version)
    newer = []
    for section in parse_changelog_sections(changelog_text):
        if section['version'].lower() == 'unreleased':
            newer.append(section)
            continue
        section_tuple = _version_tuple(section['version'])
        if section_tuple is not None and (current_tuple is None or section_tuple > current_tuple):
            newer.append(section)
    return newer


def _cache_path():
    return Path(settings.BASE_DIR) / CACHE_FILENAME


def _read_cache():
    try:
        data = json.loads(_cache_path().read_text(encoding='utf-8'))
        checked_at = datetime.fromisoformat(data['checked_at'])
        if checked_at.tzinfo is None:
            # A cache written without a timezone must not crash the
            # freshness subtraction below — read it as UTC.
            checked_at = checked_at.replace(tzinfo=dt_timezone.utc)
        if datetime.now(dt_timezone.utc) - checked_at > CACHE_MAX_AGE:
            return None
        return data
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_cache(status):
    try:
        _cache_path().write_text(json.dumps(status, ensure_ascii=False), encoding='utf-8')
    except OSError:
        logger.exception('Could not write the update status cache')


def get_update_status(force=False):
    """Current vs remote version state; cached unless ``force``."""
    if not force:
        cached = _read_cache()
        if cached is not None:
            return cached
    root = repo_root()
    status = {
        'available': False,
        'reason': '',
        'current_version': _read_version(root),
        'branch': '',
        'current_sha': '',
        'remote_sha': '',
        'behind': 0,
        'latest_version': '',
        'changes': [],
        'checked_at': datetime.now(dt_timezone.utc).isoformat(),
        'approved_pending': (root / FLAG_FILENAME).exists(),
    }
    try:
        status['branch'] = _run_git(['rev-parse', '--abbrev-ref', 'HEAD'])
        status['current_sha'] = _run_git(['rev-parse', 'HEAD'])[:12]
        _run_git(['fetch', 'origin', status['branch']], timeout=60)
        status['remote_sha'] = _run_git(['rev-parse', f"origin/{status['branch']}"])[:12]
        behind = _run_git(['rev-list', '--count', f"HEAD..origin/{status['branch']}"])
        status['behind'] = int(behind or 0)
        status['available'] = True
        if status['behind'] > 0:
            status['latest_version'] = _run_git(['show', f"origin/{status['branch']}:VERSION"]).strip()
            changelog = _run_git(['show', f"origin/{status['branch']}:CHANGELOG.md"])
            status['changes'] = changes_since(changelog, status['current_version'])
    except (RuntimeError, subprocess.SubprocessError, ValueError, OSError) as error:
        status['reason'] = f'بررسی آپدیت انجام نشد: {str(error)[:200]}'
        logger.warning('Update check failed: %s', error)
    _write_cache(status)
    return status


def quick_update_status():
    """Cache-only status for cheap polling (never touches the network)."""
    cached = _read_cache()
    if cached is not None:
        return cached
    root = repo_root()
    return {
        'available': False,
        'reason': 'هنوز بررسی نشده است.',
        'current_version': _read_version(root),
        'branch': '',
        'current_sha': '',
        'remote_sha': '',
        'behind': 0,
        'latest_version': '',
        'changes': [],
        'checked_at': '',
        'approved_pending': (root / FLAG_FILENAME).exists(),
    }


def approve_update(requested_by=''):
    """Stage an approved update: write the flag the updater requires.

    On Windows the detached apply helper is spawned too: it stops the
    server, runs the (forced) updater and relaunches the app, so the
    superuser's click is the only manual step. On other platforms the
    flag alone is written and the next launcher start applies it.
    Returns (ok, detail_dict).
    """
    status = get_update_status(force=True)
    if not status['available']:
        return False, {'detail': status['reason'] or 'بررسی آپدیت انجام نشد.'}
    if status['behind'] <= 0:
        return False, {'detail': 'نسخهٔ جدیدی برای نصب وجود ندارد.'}
    root = repo_root()
    flag = {
        'target_sha': status['remote_sha'],
        'latest_version': status['latest_version'],
        'requested_by': requested_by,
        'at': datetime.now(dt_timezone.utc).isoformat(),
    }
    try:
        (root / FLAG_FILENAME).write_text(json.dumps(flag, ensure_ascii=False), encoding='utf-8')
    except OSError:
        logger.exception('Could not write the update approval flag')
        return False, {'detail': 'نوشتن فایل تأیید آپدیت انجام نشد.'}
    spawned = False
    if os.name == 'nt':
        helper = root / 'apply_update.ps1'
        if helper.exists():
            try:
                subprocess.Popen(
                    [
                        'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                        '-File', str(helper), '-RepoRoot', str(root),
                    ],
                    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
                    close_fds=True,
                )
                spawned = True
            except OSError:
                logger.exception('Could not spawn apply_update.ps1')
    return True, {
        'staged': True,
        'spawned': spawned,
        'latest_version': status['latest_version'],
        'target_sha': status['remote_sha'],
    }
