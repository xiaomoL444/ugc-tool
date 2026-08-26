const { defineConfig } = require('@vue/cli-service')

module.exports = defineConfig({
  transpileDependencies: true,
  configureWebpack: {
    resolve: {
      alias: {
        path: "path-browserify",
      },
    },
  },
  devServer: {
    proxy: {
      "/ugc-tool-data": {
        target: "https://oss.xiaomol444.xyz",
        changeOrigin: true,
      },
    },
    client: {
      overlay: {
        runtimeErrors: (error) => {
          const message = error?.message || String(error || "")
          return !message.includes("ResizeObserver loop")
        },
      },
    },
  },
})
