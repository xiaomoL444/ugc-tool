const { defineConfig } = require('@vue/cli-service')

module.exports = defineConfig({
  transpileDependencies: true,
  chainWebpack: (config) => {
    config.plugin('define').tap((definitions) => {
      Object.assign(definitions[0], {
        __VUE_I18N_FULL_INSTALL__: true,
        __VUE_I18N_LEGACY_API__: false,
        __INTLIFY_DROP_MESSAGE_COMPILER__: false,
        __INTLIFY_PROD_DEVTOOLS__: false,
      })
      return definitions
    })
  },
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
