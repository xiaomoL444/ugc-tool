const { spawnSync } = require("child_process")
const fs = require("fs")

const repo = "https://github.com/xiaomoL444/ugc-data-repo.git"
const dir = "public/data"

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit"
  })

  if (res.status !== 0) {
    process.exit(res.status)
  }
}

if (!fs.existsSync(dir)) {
  console.log("📦 cloning data repo...")
  run("git", ["clone", "--depth=1", repo, dir])
} else {
  console.log("🔄 updating data repo...")
  run("git", ["pull"], dir)
}