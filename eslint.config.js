import parser from "@typescript-eslint/parser";
import plugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

export default [
  // --- Configuration for SOURCE files ---
  {
    files: [
      "src/*.ts",
      "src/common/**/*.ts",
      "src/stores/**/*.ts",
      "src/tools/**/*.ts",
      "!src/**/*.test.ts",
      "!src/**/__tests__/**/*.ts",
    ],
    languageOptions: {
      parser: parser,
      ecmaVersion: 2021,
      sourceType: "module",
      globals: { ...globals.node }
    },
    plugins: { "@typescript-eslint": plugin },
    rules: {
      ...plugin.configs.recommended.rules,
    },
    ignores: ["dist/", "coverage/", "node_modules/"],
  },

  // --- Configuration for TEST files ---
  {
    files: [
      "src/**/*.test.ts",
      "src/**/__tests__/**/*.ts",
    ],
    languageOptions: {
      parser: parser,
      ecmaVersion: 2021,
      sourceType: "module",
      globals: { ...globals.jest, ...globals.node }
    },
    plugins: { "@typescript-eslint": plugin },
    rules: {
      // Keep recommended rules, but override require ones
      ...plugin.configs.recommended.rules,

      // --- Override: Disable require-related rules for test files ---
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",

    },
    ignores: ["dist/", "coverage/", "node_modules/"],
  }
];
