/// <reference types="vite/client" />
/// <reference types="vite-plugin-monkey/client" />
/// <reference types="vite-plugin-monkey/style" />

declare module 'virtual:tamperina-rina' {
  const rina: Record<string, string>
  export default rina
}

declare module 'virtual:tamperina-fonts' {
  const css: string
  export default css
}
