#import "template.typ": *
#import "render.typ": render-resume
#let locale = sys.inputs.at("locale", default: "en")
#let suffix = if locale == "en" { "" } else { "_" + locale }
#let data = json("generated/resume" + suffix + ".json")
#show: body => resume(body, locale: locale, title: data.documentTitle)

#identity("IAN HENRIQUES", [
  #contact("home")[Winter Springs, FL]#separator#contact("city")[Cambridge, MA]#separator#contact("phone")[321-222-7234]#separator#contact("email")[#link("mailto:ian@ianlh.com")[ian\@ianlh.com]] \
  #contact("linkedin")[#link("https://www.linkedin.com/in/ian-henriques/")]#separator#contact("github")[#link("https://github.com/logflash")]
])

// Content is generated from src/content/Resume.mdx. Edit the MDX, not JSON.
#render-resume(data)
