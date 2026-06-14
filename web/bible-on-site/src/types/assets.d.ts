// Ambient declarations for side-effect style imports.
//
// TypeScript 6 (TS2882) requires type declarations for side-effect imports of
// non-code assets such as CSS. Next.js handles the actual bundling at build
// time; these declarations only satisfy the type checker for `import "./x.css"`
// style imports. CSS Modules (`import styles from "./x.module.css"`) keep their
// own typing from Next.js.

declare module "*.css";
declare module "*.scss";
declare module "*.sass";
