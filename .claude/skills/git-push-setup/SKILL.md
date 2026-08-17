---
name: git-push-setup
description: Diagnose and fix `git push`/`git fetch` failing with "Permission denied (publickey)" on a Windows machine using a passphrase-protected SSH key + the Windows ssh-agent service. Use when a git push/fetch/pull over SSH fails with a publickey error on Windows, or when setting up push access on a new Windows machine for this repo.
---

Machine-specific SSH/git plumbing, not app code - this file exists so an agent hitting a broken
`git push` on a Windows clone of this repo doesn't have to re-diagnose it from scratch. Confirmed
working setup: Windows 10, Git for Windows (MSYS-bundled ssh), a passphrase-protected
`~/.ssh/id_ed25519` key, GitHub over SSH.

## The symptom

`git push` (or `fetch`/`pull`) fails with:
```
git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.
```
...even though the user says they've already run `ssh-add` and it succeeded.

## Root cause (two separate bugs stacked together)

1. **Git Bash's own `ssh`/`ssh-add` cannot talk to the Windows `ssh-agent` service at all.**
   Git for Windows bundles an MSYS-built OpenSSH (`/usr/bin/ssh`, `/usr/bin/ssh-add`) that does
   NOT know how to reach the Windows-native `ssh-agent` service's named pipe
   (`\\.\pipe\openssh-ssh-agent`) - not even if you set `SSH_AUTH_SOCK` to point at it (tested:
   still fails with `Error connecting to agent: No such file or directory`). Only the *native*
   Windows OpenSSH build at `C:\Windows\System32\OpenSSH\ssh.exe`/`ssh-add.exe` talks to that
   service. If the user ran `ssh-add` inside Git Bash, it silently used the wrong binary and
   never actually loaded the key anywhere useful.
2. **Even from PowerShell, plain `git push` still fails.** `git.exe` (Git for Windows) resolves
   its *own* bundled `ssh.exe` internally when shelling out for the SSH transport - it does NOT
   respect whatever `ssh.exe` PowerShell's own `$env:PATH` would resolve to. So even after `ssh -T
   git@github.com` succeeds directly in PowerShell (proving the key/agent are fine), `git push`
   in that same PowerShell window still fails with the exact same publickey error, because git
   is quietly shelling out to the broken MSYS ssh.exe underneath, not the one that just worked.

## Fix

**Step 1 - the Windows ssh-agent service must be running.**
```powershell
Get-Service ssh-agent
Start-Service ssh-agent   # if Status is Stopped
```
Optional but recommended so this survives a reboot without re-doing this step:
```powershell
Set-Service ssh-agent -StartupType Automatic
```

**Step 2 - the human (not the agent) loads the key, in PowerShell, not Git Bash.**
This is the one step an agent must never attempt or offer to do on the user's behalf - it
requires the key's passphrase, which the agent should never see, ask for, or type on the user's
behalf. Tell the user to run, in their own PowerShell window:
```powershell
ssh-add "$env:USERPROFILE\.ssh\id_ed25519"
```
(adjust the filename if their key isn't the default `id_ed25519`). They enter the passphrase
there. The key then stays loaded in the Windows service until the service restarts or the machine
reboots - `ssh-add` needs re-running after either of those, but everything below is one-time.

**Step 3 - verify the agent/key actually work, from PowerShell specifically:**
```powershell
ssh -T git@github.com
```
Success looks like `Hi <username>! You've successfully authenticated, but GitHub does not
provide shell access.` (that message is itself success - GitHub always declines shell access).
`(Get-Command ssh).Source` should print `C:\Windows\System32\OpenSSH\ssh.exe` - if it prints
something under `Git\usr\bin` instead, PATH is resolving the wrong one and step 3 will falsely
seem to fail even with a correctly-loaded key.

**Step 4 - fix git's own ssh resolution (this is the part that's easy to miss even after steps
1-3 all check out).** Point git at the native Windows ssh.exe explicitly, per-repo (not
`--global`, so it doesn't affect the user's other repos, which might not have this same issue or
might use a different key/agent setup):
```powershell
git config core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"
```
Forward slashes matter here - git passes this string through its own MSYS `sh -c`, and backslashes
get eaten/misparsed (`C:\Windows\...` silently becomes the mangled, non-existent
`C:WindowsSystem32...`). This setting lives in this clone's own `.git/config`, which is **never
committed/versioned** - it must be re-applied on every fresh clone of this repo, on every machine,
even ones "configured very much the same" as one that already works.

**Step 5 - verify `git` itself (not just raw `ssh`) works, from both shells:**
```powershell
git fetch origin    # PowerShell
```
```bash
git fetch origin    # Git Bash - core.sshCommand is a git-level setting, applies regardless of shell
```
Both should exit cleanly with no publickey error.

## Quick checklist for a new machine

1. Confirm `~/.ssh/id_ed25519` (or whatever key GitHub has the matching public key for) actually
   exists on that machine - it's a local file, never synced by this repo or by git itself.
2. `Get-Service ssh-agent` -> `Start-Service ssh-agent` if stopped.
3. Ask the human to `ssh-add` it themselves, in PowerShell, entering their own passphrase.
4. `git config core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"` in this repo's clone on
   that machine.
5. `git fetch origin` from both PowerShell and Git Bash to confirm.
