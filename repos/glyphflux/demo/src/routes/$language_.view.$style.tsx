import { createFileRoute, redirect } from '@tanstack/react-router'
import { ViewTransitionDemo } from '../ViewTransitionDemo'
import { languageCodes } from '../catalog'

export const Route = createFileRoute('/$language_/view/$style')({
  beforeLoad: ({ params }) => {
    if (!languageCodes.has(params.language) || !['sans', 'serif'].includes(params.style)) {
      throw redirect({ to: '/$language', params: { language: 'en' } })
    }
  },
  head: ({ params }) => ({
    meta: [{ title: `Glyphflux view transition · ${params.language}` }],
  }),
  component: ViewTransitionRoute,
})

function ViewTransitionRoute() {
  const params = Route.useParams()
  const navigate = Route.useNavigate()
  return (
    <ViewTransitionDemo
      locale={params.language}
      fontRole={params.style as 'sans' | 'serif'}
      onNavigate={(fontRole) =>
        void navigate({
          to: '/$language/view/$style',
          params: { language: params.language, style: fontRole },
        })
      }
      onLocaleChange={(language) =>
        void navigate({
          to: '/$language/view/$style',
          params: { language, style: params.style },
        })
      }
    />
  )
}

