// MDX source literals are registered for extraction in the generated
// mdxMessages.ts catalog. MdxContent is excluded from GT's static
// scan because its translation calls necessarily receive component props.
export { useTranslate as useMdxGT } from './i18n'
