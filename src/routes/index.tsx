import { createFileRoute, redirect } from '@tanstack/react-router'
import { getLocale } from 'gt-tanstack-start'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/localePath'

// The bare `/` redirects to the visitor's locale, resolved server-side by
// gtMiddleware (its cookie from a previous visit, then Accept-Language).
export const Route = createFileRoute('/')({
  loader: () => {
    const detected = getLocale()
    const locale = SUPPORTED_LOCALES.includes(detected) ? detected : DEFAULT_LOCALE
    throw redirect({ to: '/$locale', params: { locale } })
  },
})
