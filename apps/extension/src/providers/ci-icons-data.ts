/** Passive CI glyph geometry from @gitlab/svgs 3.171.0 and @atlaskit/icon 38.0.2.
 * Native sources and licenses: public/third-party/category-tree-icons.txt.
 */
interface CheckGlyph { readonly viewBox: string; readonly shapes: readonly { readonly tag: 'path' | 'rect' | 'ellipse' | 'circle'; readonly attributes: Readonly<Record<string, string>> }[] }
export const CI_GLYPHS: Readonly<Record<string, CheckGlyph>> = {
  "status_success_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "d": "M9.866 12.095l-1.95-1.95a.462.462 0 00-.647.01l-.964.964a.46.46 0 00-.01.646l3.013 3.014a.787.787 0 001.106.008l.425-.425 4.854-4.853a.462.462 0 00.002-.659l-.964-.964a.468.468 0 00-.658.002l-4.207 4.207z"
        }
      }
    ]
  },
  "status_pending_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "d": "M7.386 8.329c0-.315.157-.472.471-.472h1.414c.315 0 .472.157.472.472v5.342c0 .315-.157.472-.472.472H7.857c-.314 0-.471-.157-.471-.472V8.33m4.714 0c0-.315.157-.472.471-.472h1.415c.314 0 .471.157.471.472v5.342c0 .315-.157.472-.471.472H12.57c-.314 0-.471-.157-.471-.472V8.33"
        }
      }
    ]
  },
  "status_running_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "d": "M11 4.714c3.457 0 6.286 2.829 6.286 6.286 0 3.457-2.829 6.286-6.286 6.286-2.043 0-3.929-1.1-5.186-2.672L11 11V4.714"
        }
      }
    ]
  },
  "status_failed_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "d": "M11 9.38L8.798 7.178a.455.455 0 00-.65.006l-.964.965a.462.462 0 00-.006.65L9.38 11l-2.202 2.202a.455.455 0 00.006.65l.965.964a.462.462 0 00.65.006L11 12.62l2.202 2.202a.455.455 0 00.65-.006l.964-.965a.462.462 0 00.006-.65L12.62 11l2.202-2.202a.455.455 0 00-.006-.65l-.965-.964a.462.462 0 00-.65-.006L11 9.38z"
        }
      }
    ]
  },
  "status_canceled_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "d": "M8.171 5.971l7.7 7.7a.76.76 0 010 1.1l-1.1 1.1a.76.76 0 01-1.1 0l-7.7-7.7a.76.76 0 010-1.1l1.1-1.1a.76.76 0 011.1 0"
        }
      }
    ]
  },
  "status_skipped_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "d": "M14.072 11.063l-2.82 2.82a.46.46 0 00-.001.652l.495.495a.457.457 0 00.653-.001l3.7-3.7a.46.46 0 00.001-.653l-.196-.196a.453.453 0 00-.03-.033l-3.479-3.479a.464.464 0 00-.654.007l-.548.548a.463.463 0 00-.007.654l2.886 2.886z"
        }
      },
      {
        "tag": "path",
        "attributes": {
          "d": "M10.08 11.063l-2.819 2.82a.46.46 0 00-.002.652l.496.495a.457.457 0 00.652-.001l3.7-3.7a.46.46 0 00.002-.653l-.196-.196a.453.453 0 00-.03-.033l-3.48-3.479a.464.464 0 00-.653.007l-.548.548a.463.463 0 00-.007.654l2.886 2.886z"
        }
      }
    ]
  },
  "status_manual_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "d": "M16.5 11.99v-1.98l-1.238-.206c-.068-.273-.206-.546-.412-.956l.756-1.025-1.444-1.435-1.03.752a3.686 3.686 0 00-.963-.41L12.03 5.5h-1.994l-.206 1.23c-.343.068-.618.205-.962.41l-1.031-.752-1.444 1.435.687 1.025c-.206.341-.275.615-.412.956L5.5 9.941v1.981l1.237.205c.07.342.207.615.413.957l-.688 1.025 1.444 1.434 1.032-.683c.274.137.618.274.962.41l.206 1.23h2.063l.206-1.23c.344-.068.619-.205.963-.41l1.03.752 1.444-1.435-.756-1.025c.207-.341.344-.683.413-.956l1.031-.205zM11 13.017c-1.169 0-2.063-.889-2.063-2.05 0-1.162.894-2.05 2.063-2.05s2.063.888 2.063 2.05c0 1.161-.894 2.05-2.063 2.05z"
        }
      }
    ]
  },
  "status_scheduled_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "d": "M10.78 16.17a5.39 5.39 0 110-10.78 5.39 5.39 0 010 10.78zm0-1.54a3.85 3.85 0 100-7.7 3.85 3.85 0 000 7.7z"
        }
      },
      {
        "tag": "rect",
        "attributes": {
          "x": "10.01",
          "y": "7.7",
          "width": "1.54",
          "height": "3.85",
          "rx": ".767"
        }
      },
      {
        "tag": "rect",
        "attributes": {
          "x": "10.01",
          "y": "10.01",
          "width": "3.08",
          "height": "1.54",
          "rx": ".767"
        }
      }
    ]
  },
  "status_created_borderless": {
    "viewBox": "0 0 22 22",
    "shapes": [
      {
        "tag": "circle",
        "attributes": {
          "cx": "11",
          "cy": "11",
          "r": "5.107"
        }
      }
    ]
  },
  "status_preparing_borderless": {
    "viewBox": "0 0 16 16",
    "shapes": [
      {
        "tag": "circle",
        "attributes": {
          "fill-rule": "evenodd",
          "cx": "8",
          "cy": "8",
          "r": "2"
        }
      },
      {
        "tag": "circle",
        "attributes": {
          "fill-rule": "evenodd",
          "cx": "14",
          "cy": "8",
          "r": "2"
        }
      },
      {
        "tag": "circle",
        "attributes": {
          "fill-rule": "evenodd",
          "cx": "2",
          "cy": "8",
          "r": "2"
        }
      }
    ]
  },
  "bitbucket-check-circle": {
    "viewBox": "0 0 16 16",
    "shapes": [
      {
        "tag": "path",
        "attributes": {
          "fill": "currentcolor",
          "d": "M14.5 8a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0m-2.174-2.52-5 6a.75.75 0 0 1-1.152 0l-2.5-3 1.152-.96L6.75 9.828l4.424-5.308zM16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0"
        }
      }
    ]
  }
};
