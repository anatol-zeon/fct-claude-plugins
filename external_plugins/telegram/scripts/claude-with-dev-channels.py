#!/usr/bin/env python3
"""Wraps `claude` so the one-time --dangerously-load-development-channels
warning is auto-confirmed.

A fork of claude-plugins-official isn't on Anthropic's curated channel-plugin
allowlist, so the bridge needs `--dangerously-load-development-channels` to
register its channel. That flag triggers an interactive "WARNING: Loading
development channels" menu (pick "I am using this for local development",
press Enter) on every session start — there's no documented flag to suppress
it in CC 2.1.138. For an unattended wrapper-loop (tmux / systemd) that's a
blocker, so we attach claude to a pty via pexpect, watch for the warning,
send Enter once, then wait for claude to exit. claude's output is mirrored to
our stderr so the wrapper-loop logs (and `journalctl --user -u
claude-tg-bridge`) stay readable.

Args after the script name are forwarded verbatim to `claude`. `CLAUDE_BIN`
env overrides the binary path; otherwise we resolve `claude` via PATH. Set
`TG_BRIDGE_TRACE=/path` to dump the raw pty stream for debugging. Exit code
mirrors claude's.
"""
import os
import shutil
import sys
import time

import pexpect


def find_claude() -> str:
    explicit = os.environ.get("CLAUDE_BIN")
    if explicit:
        return explicit
    found = shutil.which("claude")
    if not found:
        sys.stderr.write("[claude-with-dev-channels] 'claude' not in PATH; set CLAUDE_BIN\n")
        sys.exit(127)
    return found


def main() -> int:
    child = pexpect.spawn(
        find_claude(),
        args=sys.argv[1:],
        # Wide terminal — the warning menu wraps in narrow ones, which would
        # scramble the pattern match.
        dimensions=(40, 200),
        encoding="utf-8",
        timeout=None,
    )
    child.logfile_read = sys.stderr

    trace = os.environ.get("TG_BRIDGE_TRACE")
    if trace:
        # spawn() uses encoding='utf-8', so pexpect logs strings — open text mode.
        child.logfile = open(trace, "w", encoding="utf-8")

    try:
        # CC renders each menu word as its own styled cell with ANSI cursor
        # moves between them, so multi-word patterns never match in the raw
        # pty stream. Anchor on the single contiguous word "Loading" (unique
        # to the dev-channels warning). After a settle delay for the rest of
        # the menu to draw, send a bare CR — CC's menus read raw-mode key
        # input where Enter is "\r"; sendline()'s platform linesep doesn't
        # register here.
        idx = child.expect(["Loading", pexpect.EOF], timeout=30)
        sys.stderr.write(f"[claude-with-dev-channels] dev-channels prompt match idx={idx}\n")
        if idx == 0:
            time.sleep(1.5)
            child.send("\r")
            sys.stderr.write("[claude-with-dev-channels] confirmed dev-channels prompt\n")
        # Wait until claude exits (e.g. /newsession SIGTERMs it → wrapper-loop
        # restarts → this helper runs again for the fresh session).
        child.expect(pexpect.EOF, timeout=None)
    except KeyboardInterrupt:
        child.sendintr()
        try:
            child.expect(pexpect.EOF, timeout=10)
        except pexpect.exceptions.TIMEOUT:
            pass
    finally:
        if child.isalive():
            child.terminate(force=True)

    child.close()
    if child.exitstatus is not None:
        return child.exitstatus
    if child.signalstatus is not None:
        return 128 + child.signalstatus
    return 1


if __name__ == "__main__":
    sys.exit(main())
