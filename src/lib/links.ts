/** Anchor props for links that should open in a new tab. */
export function externalProps(external?: boolean) {
  return external ? ({ target: '_blank', rel: 'noreferrer' } as const) : {}
}
