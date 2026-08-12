import js from "@eslint/js"

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        Uint8Array: "readonly",
        atob: "readonly",
        btoa: "readonly"
      },
      sourceType: "module"
    },
    rules: {
      semi: ["error", "never"],
      quotes: ["error", "double"]
    }
  }
]
