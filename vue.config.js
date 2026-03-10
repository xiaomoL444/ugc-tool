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
  chainWebpack: config => {
    const svgRule = config.module.rule('svg')

    svgRule.exclude.add(/src\/assets\/svg/)

    config.module
      .rule('icons')
      .test(/\.svg$/)
      .include.add(/src\/assets\/svg/)
      .end()
      .use('vue-svg-loader')
      .loader('vue-svg-loader')
  }
})