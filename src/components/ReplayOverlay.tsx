import { GTReplayer } from 'gt-rrweb/replay'
import type { GTReplayerBundle, GTReplayerFrame } from 'gt-rrweb/replay'
import { harvestLocales } from 'gt-rrweb/harvest'
import {
  createFontMorphReplayDirector,
  prepareFontMorphReplay,
  reserveFontMorphSettledTextHolds,
} from 'gt-rrweb/glyphflux'
import { hashMessage } from 'gt-i18n/internal'
import { useEffect, useMemo, useState } from 'react'
import { SUPPORTED_LOCALES } from '../lib/localePath'
import { prepareFontMorph } from '../lib/fontMorph'
import {
  createSkillCardReplayDirector,
  upgradeLegacySkillCardAnimations,
} from '../lib/skillCardAnimation'
import loadTranslations from '../loadTranslations'
import { useTranslate } from '../lib/i18n'

type MorphTranslationTable = Awaited<ReturnType<typeof loadTranslations>>
type MorphTranslations = Record<string, MorphTranslationTable>

function resolveMorphText(
  translations: MorphTranslations,
  locale: string | undefined,
  translationHash: string | undefined,
  recordedText: string,
) {
  let resolvedHash = translationHash
  if (!resolvedHash) {
    for (const table of Object.values(translations)) {
      const match = Object.entries(table).find(([, value]) => value === recordedText)
      if (match) {
        resolvedHash = match[0]
        break
      }
    }
  }
  const value = locale && resolvedHash ? translations[locale]?.[resolvedHash] : undefined
  return typeof value === 'string' ? value : undefined
}

/**
 * Full-screen replay overlay, opened by dropping a recording on the avatar
 * (Identity). The player runs in gt-rrweb debug mode, so dropping another
 * recording JSON anywhere on the box hot-swaps the replay in place. A file
 * that is not a recording refreshes the page. Clicking the backdrop (outside
 * the player box) collapses the overlay.
 */
export function ReplayOverlay({
  bundle,
  initialLocale,
}: {
  bundle: GTReplayerBundle
  initialLocale?: string
}) {
  const gt = useTranslate()
  const [directorReady, setDirectorReady] = useState(false)
  const [morphTranslations, setMorphTranslations] = useState<MorphTranslations>({})
  const [replayBundle, setReplayBundle] = useState<{
    source: GTReplayerBundle
    prepared: GTReplayerBundle
  } | null>(null)
  const renderFontMorph = useMemo(
    () =>
      createFontMorphReplayDirector((locale, translationHash, recordedText) =>
        resolveMorphText(morphTranslations, locale, translationHash, recordedText),
      ),
    [morphTranslations],
  )
  const renderSkillCards = useMemo(() => createSkillCardReplayDirector(), [])
  const renderReplayFrame = useMemo(
    () => (frame: GTReplayerFrame) => {
      const directive = renderFontMorph(frame)
      renderSkillCards(frame)
      return directive
    },
    [renderFontMorph, renderSkillCards],
  )

  // GTReplayer starts its clock as soon as it mounts. Load build-generated
  // morph data and locale text first so neither preparation nor translation
  // can join an animation midway. Unknown text falls back to the worker.
  useEffect(() => {
    let current = true
    setDirectorReady(false)
    setReplayBundle(null)
    const localeTables = Promise.all(
      SUPPORTED_LOCALES.map(async (locale) => {
        try {
          return [locale, await loadTranslations(locale)] as const
        } catch (error) {
          console.error(`Unable to preload ${locale} replay translations`, error)
          return [locale, {}] as const
        }
      }),
    )

    void (async () => {
      const [, tables] = await Promise.all([
        prepareFontMorph().catch((error: unknown) => {
          console.error('Unable to preload the font morph replay director', error)
        }),
        localeTables,
      ])
      const translations = Object.fromEntries(tables)
      const locales = [...(bundle.locales ?? [])]
      const upgradedEvents = upgradeLegacySkillCardAnimations(bundle.events)
      const events = reserveFontMorphSettledTextHolds(upgradedEvents)
      let preparedBundle = events === bundle.events ? bundle : { ...bundle, events }
      if (locales.length > 1) {
        // Older recordings can have an incomplete embedded overlay because
        // rrweb serializes a React-created hashed element and its text as
        // separate mutation additions. Re-harvest from the event graph with
        // the app's current dictionaries so those route-created nodes are
        // translated too; the patched recorder writes this complete map for
        // new recordings at stop time.
        const repaired = await harvestLocales(events, locales, {
          sourceLocale: locales[0],
          loadTranslations: async (locale) => translations[locale] ?? {},
          hashMessage: (message) => hashMessage(message, { $format: 'ICU' }),
        })
        const overlay = { ...bundle.overlay }
        for (const [locale, entries] of Object.entries(repaired)) {
          overlay[locale] = { ...overlay[locale], ...entries }
        }
        preparedBundle = { ...preparedBundle, overlay }
      }
      try {
        await prepareFontMorphReplay(
          events,
          SUPPORTED_LOCALES,
          (locale, translationHash, recordedText) =>
            resolveMorphText(translations, locale, translationHash, recordedText),
          document,
        )
      } catch (error) {
        // The director's exact-destination fallback remains usable if a font
        // resource is temporarily unavailable.
        console.error('Unable to precompute replay font morphs', error)
      }
      if (!current) return
      setMorphTranslations(translations)
      setReplayBundle({ source: bundle, prepared: preparedBundle })
      setDirectorReady(true)
    })()

    return () => {
      current = false
    }
  }, [bundle.events])

  // Lock page scroll while the overlay is up: the page behind shouldn't move,
  // and hiding its scrollbar lets the full-viewport overlay center the box on
  // the true screen axes (a classic scrollbar otherwise shifts it sideways).
  useEffect(() => {
    const html = document.documentElement
    const previous = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = previous
    }
  }, [])
  return (
    <div className="replay-overlay-box" aria-busy={!directorReady}>
      {directorReady && replayBundle?.source === bundle ? (
        <GTReplayer
          frameTitle={gt('Recording replay')}
          bundle={replayBundle.prepared}
          initialLocale={initialLocale}
          onFrame={renderReplayFrame}
          debug
        />
      ) : null}
    </div>
  )
}
