import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { globalIgnores } from "eslint/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  globalIgnores(["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]),
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      '@next/next/no-img-element': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default eslintConfig;