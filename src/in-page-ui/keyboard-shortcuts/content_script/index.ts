import Mousetrap from 'mousetrap'
import { getKeyboardShortcutsState } from 'src/in-page-ui/keyboard-shortcuts/content_script/detection'
import { userSelectedText } from 'src/in-page-ui/tooltip/content_script/interactions'
import { createAndCopyDirectLink } from 'src/annotations/content_script/interactions'
import { SharedInPageUIInterface } from 'src/in-page-ui/shared-state/types'
import { KeyboardShortcuts } from '../types'
import { AnnotationFunctions } from 'src/in-page-ui/tooltip/types'
import { RpcError } from 'src/util/webextensionRPC'

type HandleInterface = {
    [key in keyof KeyboardShortcuts]: () => Promise<void>
}

export interface KeyboardShortcutsDependencies extends AnnotationFunctions {
    inPageUI: SharedInPageUIInterface
}

export async function initKeyboardShortcuts(
    dependencies: KeyboardShortcutsDependencies,
) {
    const { shortcutsEnabled, ...shortcuts } = await getKeyboardShortcutsState()
    if (shortcutsEnabled) {
        const handlers = getShortcutHandlers(dependencies)
        for (const [shortcutName, shortcutValue] of Object.entries(shortcuts)) {
            if (shortcutValue.enabled) {
                Mousetrap.bind(
                    shortcutValue.shortcut,
                    prepareShortcutHandler(handlers[shortcutName]),
                )
            }
        }
    }
}

export const resetKeyboardShortcuts = () => Mousetrap.reset()

function prepareShortcutHandler(handler: () => Promise<void>) {
    return function (event) {
        event.preventDefault()
        event.stopPropagation()
        return handler().catch((err) => {
            if (err instanceof RpcError) {
                resetKeyboardShortcuts()
            }
        })
    }
}

function getShortcutHandlers({
    inPageUI,
    ...annotationFunctions
}: KeyboardShortcutsDependencies): HandleInterface {
    return {
        addComment: () => inPageUI.showRibbon({ action: 'comment' }),
        addTag: () => inPageUI.showRibbon({ action: 'tag' }),
        addToCollection: () => inPageUI.showRibbon({ action: 'list' }),
        createBookmark: () => inPageUI.showRibbon({ action: 'bookmark' }),
        toggleSidebar: () => inPageUI.toggleSidebar(),
        toggleHighlights: () => inPageUI.toggleHighlights(),
        createHighlight: annotationFunctions.createHighlight,
        createAnnotation: annotationFunctions.createAnnotation,
        openSearch: () => inPageUI.toggleSidebar(),
        link: async () => {
            if (userSelectedText()) {
                await createAndCopyDirectLink()
            }
        },
    }
}
