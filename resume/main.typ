#import "template.typ": *
#import "render.typ": render-resume
#show: resume

#identity("IAN HENRIQUES", [
  #contact("home")[Winter Springs, FL]#separator#contact("city")[Cambridge, MA]#separator#contact("phone")[321-222-7234]#separator#contact("email")[#link("mailto:ian@ianlh.com")[ian\@ianlh.com]] \
  #contact("linkedin")[#link("https://www.linkedin.com/in/ian-henriques/")]#separator#contact("github")[#link("https://github.com/logflash")]
])

// Content is generated from src/content/Resume.mdx. Edit the MDX, not JSON.
#render-resume(json("generated/resume.json"))
