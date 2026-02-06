import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

let fontDataCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

async function loadFonts() {
  if (fontDataCache) return fontDataCache;

  const [regular, bold] = await Promise.all([
    fetch(
      "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj7oUUsjNsFjTQpJ.ttf"
    ).then((r) => r.arrayBuffer()),
    fetch(
      "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj4PVksjNsFjTQpJ.ttf"
    ).then((r) => r.arrayBuffer()),
  ]);

  fontDataCache = { regular, bold };
  return fontDataCache;
}

export async function generateOgImage(
  title: string,
  description: string,
  isLanding = false
) {
  const fonts = await loadFonts();

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0E1319",
          position: "relative",
          overflow: "hidden",
        },
        children: [
          // Background gradient glow (top-right)
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: "-120px",
                right: "-120px",
                width: "500px",
                height: "500px",
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(234,107,62,0.15) 0%, rgba(234,107,62,0) 70%)",
              },
            },
          },
          // Background gradient glow (bottom-left)
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: "-80px",
                left: "-80px",
                width: "350px",
                height: "350px",
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(234,107,62,0.08) 0%, rgba(234,107,62,0) 70%)",
              },
            },
          },
          // Content container
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "60px",
                height: "100%",
                position: "relative",
              },
              children: [
                // Top section: logo + name
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                    },
                    children: [
                      // Orange dot (brand mark)
                      {
                        type: "div",
                        props: {
                          style: {
                            width: "16px",
                            height: "16px",
                            borderRadius: "50%",
                            backgroundColor: "#EA6B3E",
                          },
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: "24px",
                            fontFamily: "Space Grotesk",
                            fontWeight: 400,
                            color: "rgba(241, 237, 228, 0.6)",
                            letterSpacing: "-0.02em",
                          },
                          children: "better-env",
                        },
                      },
                    ],
                  },
                },
                // Middle section: title + description
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      gap: "16px",
                      maxWidth: isLanding ? "900px" : "800px",
                    },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: isLanding ? "56px" : "48px",
                            fontFamily: "Space Grotesk",
                            fontWeight: 700,
                            color: "#F1EDE4",
                            lineHeight: 1.15,
                            letterSpacing: "-0.03em",
                          },
                          children: title,
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: "22px",
                            fontFamily: "Space Grotesk",
                            fontWeight: 400,
                            color: "rgba(241, 237, 228, 0.55)",
                            lineHeight: 1.5,
                            maxWidth: "700px",
                          },
                          children:
                            description.length > 140
                              ? description.slice(0, 140) + "..."
                              : description,
                        },
                      },
                    ],
                  },
                },
                // Bottom section: accent line + URL
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      gap: "16px",
                    },
                    children: [
                      // Orange accent line
                      {
                        type: "div",
                        props: {
                          style: {
                            width: "60px",
                            height: "3px",
                            backgroundColor: "#EA6B3E",
                            borderRadius: "2px",
                          },
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: "18px",
                            fontFamily: "Space Grotesk",
                            fontWeight: 400,
                            color: "rgba(241, 237, 228, 0.35)",
                            letterSpacing: "0.02em",
                          },
                          children: "ayronforge.com/better-env",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Space Grotesk",
          data: fonts.regular,
          weight: 400,
          style: "normal" as const,
        },
        {
          name: "Space Grotesk",
          data: fonts.bold,
          weight: 700,
          style: "normal" as const,
        },
      ],
    }
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  });

  return resvg.render().asPng();
}
