const { execSync } = require("child_process")

console.log("🚀 pushing data repo...")

execSync("git add .", {
  cwd: "public/data",
  stdio: "inherit"
})

execSync('git commit -m "update data"', {
  cwd: "public/data",
  stdio: "inherit"
})

execSync("git push", {
  cwd: "public/data",
  stdio: "inherit"
})