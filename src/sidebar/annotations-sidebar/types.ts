import type TypedEventEmitter from 'typed-emitter'
import type {
    UnifiedAnnotation,
    UnifiedList,
} from 'src/annotations/cache/types'

export type AnnotationsSidebarInPageEventEmitter = TypedEventEmitter<{
    setSelectedList: (unifiedListId: UnifiedList['unifiedId']) => void
    renderHighlight: (args: { highlight: UnifiedAnnotation }) => void
    renderHighlights: (args: { highlights: UnifiedAnnotation[] }) => void
    highlightAndScroll: (args: { highlight: UnifiedAnnotation }) => void
    // No longer used, as of the sidebar refactor
    // removeTemporaryHighlights: () => void
    // removeAnnotationHighlight: (args: { url: string }) => void
    // removeAnnotationHighlights: (args: { urls: string[] }) => void
    // hideHighlights: () => void
    // showHighlights: () => void
}>

export interface SidebarTheme {
    canClickAnnotations: boolean
    rightOffsetPx: number
    topOffsetPx: number
    paddingRight: number
}

export type AnnotationCardInstanceLocation =
    | 'annotations-tab'
    | UnifiedList['unifiedId']
