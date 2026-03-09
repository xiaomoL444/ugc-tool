const { execSync } = require("child_process")

console.log("🔄 updating data repo...")

execSync("git pull", {
  cwd: "public/data",
  stdio: "inherit"
})