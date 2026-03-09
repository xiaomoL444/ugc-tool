declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<
    Record<string, unknown>, // props
    Record<string, unknown>, // raw bindings / data
    any                        // other options
  >
  export default component
}
