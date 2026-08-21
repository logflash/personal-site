import { createFileRoute, redirect } from '@tanstack/react-router'
import { getLocale } from 'gt-tanstack-start'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/localePath'

// The bare `/` redirects to the visitor's locale. In production, Vercel
// edge redirects (vercel.json) handle this before the function is invoked;
// this loader is the equivalent fallback for local dev and `npm run start`,
// resolved by gtMiddleware (cookie from a previous visit, then
// Accept-Language).
export const Route = createFileRoute('/')({
  loader: () => {
    const detected = getLocale()
    const locale = SUPPORTED_LOCALES.includes(detected) ? detected : DEFAULT_LOCALE
    throw redirect({ to: '/$locale', params: { locale } })
  },
})
