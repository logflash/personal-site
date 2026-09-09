import { createFileRoute, redirect } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/localePath'

function localeFromPreferences(preferences: string[]) {
  for (const preference of preferences) {
    const base = preference.trim().split(';')[0].split('-')[0].toLowerCase()
    if (SUPPORTED_LOCALES.includes(base)) return base
  }
  return DEFAULT_LOCALE
}

function localeFromCookie(cookie: string) {
  const value = cookie
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === 'generaltranslation.locale')?.[1]
  return value && SUPPORTED_LOCALES.includes(value) ? value : null
}

const detectLocale = createIsomorphicFn()
  .server(() => {
    const request = getRequest()
    return (
      localeFromCookie(request.headers.get('cookie') ?? '') ??
      localeFromPreferences((request.headers.get('accept-language') ?? '').split(','))
    )
  })
  .client(
    () =>
      localeFromCookie(document.cookie) ??
      localeFromPreferences(navigator.languages as unknown as string[]),
  )

// The bare `/` redirects to the visitor's locale. In production, Vercel
// edge redirects (vercel.json) handle this before the function is invoked;
// this loader is the equivalent fallback for local dev and `npm run start`,
// resolved by gtMiddleware (cookie from a previous visit, then
// Accept-Language).
export const Route = createFileRoute('/')({
  loader: () => {
    const detected = detectLocale()
    const locale = SUPPORTED_LOCALES.includes(detected) ? detected : DEFAULT_LOCALE
    throw redirect({ to: '/$locale', params: { locale } })
  },
})
