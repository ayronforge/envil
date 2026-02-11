import { readFile } from "node:fs/promises";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

let fontDataCache: { regular: ArrayBuffer; bold: ArrayBuffer } | undefined;

function toArrayBuffer(bytes: ArrayBufferView): ArrayBuffer {
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

async function loadFonts() {
  if (fontDataCache) return fontDataCache;

  const [regularBuffer, boldBuffer] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/assets/fonts/space-grotesk-latin-400-normal.woff")),
    readFile(path.resolve(process.cwd(), "src/assets/fonts/space-grotesk-latin-700-normal.woff")),
  ]);

  fontDataCache = {
    regular: toArrayBuffer(regularBuffer),
    bold: toArrayBuffer(boldBuffer),
  };

  return fontDataCache;
}

export async function generateOgImage(title: string, description: string, isLanding = false) {
  const fonts = await loadFonts();

  // satori supports object notation but types expect ReactNode
  const element = {
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
                        children: "envil",
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
                        children: "ayronforge.com/envil",
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
  } as const;

  const svg = await satori(element as unknown as React.ReactNode, {
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
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  });

  return resvg.render().asPng();
}
