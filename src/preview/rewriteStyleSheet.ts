import { EXCLUDED_PSEUDO_ELEMENTS, PSEUDO_STATES } from "../constants"
import { splitSelectors } from "./splitSelectors"

const pseudoStates = Object.values(PSEUDO_STATES)
/** skip odd number of '\' escapes
 * but keep even
 * @example
 * skip \:pseudo-selector 
 * skip \\\:pseudo-selector 
 * 
 * keep \\:pseudo-selector
 * keep \\\\:pseudo-selector
 */
const matchOne = new RegExp(`(?<=(?<!\\\\)(?:\\\\\\\\)*):(${pseudoStates.join("|")})`)
const matchAll = new RegExp(`(?<=(?<!\\\\)(?:\\\\\\\\)*):(${pseudoStates.join("|")})`, "g")

const warnings = new Set()
const warnOnce = (message: string) => {
  if (warnings.has(message)) return
  // eslint-disable-next-line no-console
  console.warn(message)
  warnings.add(message)
}

const isExcludedPseudoElement = (selector: string, pseudoState: string) =>
  EXCLUDED_PSEUDO_ELEMENTS.some((element) => selector.endsWith(`${element}:${pseudoState}`))

const rewriteRule = ({ cssText, selectorText }: CSSStyleRule, shadowRoot?: ShadowRoot) => {
  return cssText.replace(
    selectorText,
    splitSelectors(selectorText)
      .flatMap((selector) => {
        if (selector.includes(".pseudo-")) {
          return []
        }
        if (!matchOne.test(selector)) {
          return [selector]
        }

        const states: string[] = []
        const plainSelector = selector.replace(matchAll, (_, state) => {
          states.push(state)
          return ""
        })
        const classSelector = states.reduce((acc, state) => {
          if (isExcludedPseudoElement(selector, state)) return ""
          return acc.replace(new RegExp(`(?<=(?<!\\\\)(?:\\\\\\\\)*):${state}`, "g"), `.pseudo-${state}`)
        }, selector)

        if (selector.startsWith(":host(") || selector.startsWith("::slotted(")) {
          return [selector, classSelector].filter(Boolean)
        }

        const ancestorSelector = shadowRoot
          ? `:host(${states.map((s) => `.pseudo-${s}`).join("")}) ${plainSelector}`
          : `${states.map((s) => `.pseudo-${s}`).join("")} ${plainSelector}`

        return [selector, classSelector, ancestorSelector].filter(
          (selector) => selector && !selector.includes(":not()")
        )
      })
      .join(", ")
  )
}

// Rewrites the style sheet to add alternative selectors for any rule that targets a pseudo state.
// A sheet can only be rewritten once, and may carry over between stories.
export const rewriteStyleSheet = (
  sheet: CSSStyleSheet,
  shadowRoot?: ShadowRoot,
  shadowHosts?: Set<Element>
) => {
  // @ts-expect-error
  if (sheet.__pseudoStatesRewritten) return
  // @ts-expect-error
  sheet.__pseudoStatesRewritten = true

  try {
    let index = 0
    for (const cssRule of sheet.cssRules) {
      if (!("selectorText" in cssRule)) continue
      const styleRule = cssRule as CSSStyleRule
      if (matchOne.test(styleRule.selectorText)) {
        const newRule = rewriteRule(styleRule, shadowRoot)
        sheet.deleteRule(index)
        sheet.insertRule(newRule, index)
        if (shadowRoot && shadowHosts) shadowHosts.add(shadowRoot.host)
      }
      index++
      if (index > 1000) {
        warnOnce("Reached maximum of 1000 pseudo selectors per sheet, skipping the rest.")
        break
      }
    }
  } catch (e) {
    if (String(e).includes("cssRules")) {
      warnOnce(`Can't access cssRules, likely due to CORS restrictions: ${sheet.href}`)
    } else {
      // eslint-disable-next-line no-console
      console.error(e, sheet.href)
    }
  }
}