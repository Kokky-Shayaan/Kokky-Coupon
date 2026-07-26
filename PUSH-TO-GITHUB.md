# Pushing this folder to GitHub

Repo: <https://github.com/Kokky-Shayaan/Kokky-Coupon.git>

`.gitignore` is already written and correct. Run these in **PowerShell**, from
inside this folder.

## 1. Remove the broken .git folders

I started a repo here from the sandbox, but OneDrive blocked git from cleaning
up its own lock files, so what's left is unusable. Delete it (and the stray one
in the other copy) before starting:

```powershell
Remove-Item -Recurse -Force "$HOME\Desktop\coupon-gen-v2\.git"
Remove-Item -Recurse -Force "$HOME\Desktop\coupon-gen\coupon-gen-v2\.git"
```

Adjust the paths if your Desktop is not under `$HOME` — it is on OneDrive, so
it may be `"$env:OneDrive\Desktop\..."`.

## 2. Create the repo and push

```powershell
cd "$env:OneDrive\Desktop\coupon-gen-v2"

git init -b main
git remote add origin https://github.com/Kokky-Shayaan/Kokky-Coupon.git

# Base our history on the commit already on GitHub, so no force push is needed
git fetch origin main
git update-ref refs/heads/main FETCH_HEAD
git reset --mixed HEAD

git add -A
git commit -m "Kokky voucher generator - candy design"
git push -u origin main
```

If git asks for credentials, use a **personal access token** as the password
(GitHub no longer accepts account passwords). Settings → Developer settings →
Personal access tokens → Tokens (classic), with the `repo` scope.

## What gets pushed

13 files, about 830 KB. `node_modules` (43 MB) and everything generated in
`downloads/` are excluded.

```
.gitignore
README.md
PUSH-TO-GITHUB.md
assets/bg.png
assets/Voucher fonts/Bestime.ttf
assets/Voucher fonts/Skynight.otf
coupons.json
downloads/.gitkeep
package.json
public/index.html
public/review.html
render_pdf.js
server.js
template.html
```

## After cloning it somewhere else

```bash
npm install
npx playwright install chromium   # only if Playwright complains
npm start                         # http://localhost:3001
```

## A note on OneDrive

Keeping a git repo inside a OneDrive-synced folder is workable but not ideal —
OneDrive can lock or relocate files while git is mid-operation, which is what
broke the sandbox's attempt and what moved the `coupon-gen-v3` folder earlier.
If you hit odd git errors, move the project somewhere outside OneDrive (for
example `C:\dev\Kokky-Coupon`) and work there, letting GitHub be the backup
rather than OneDrive.
