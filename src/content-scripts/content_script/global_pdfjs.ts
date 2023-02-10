import browser from 'webextension-polyfill'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/display/api'
import * as Global from './global'
import {
    FingerprintSchemeType,
    ContentFingerprint,
} from '@worldbrain/memex-common/lib/personal-cloud/storage/types'
import type { InPDFPageUIContentScriptRemoteInterface } from 'src/in-page-ui/content_script/types'
import type { GetContentFingerprints } from './types'
import { getLocalStorage, setLocalStorage } from 'src/util/storage'
import { SIDEBAR_WIDTH_STORAGE_KEY } from 'src/sidebar/annotations-sidebar/constants'
import { makeRemotelyCallableType } from 'src/util/webextensionRPC'
import { extractDataFromPDFDocument } from 'src/pdf/util'

// TODO: Properly type the PDFjs-provided globals

const waitForDocument = async () => {
    while (true) {
        const pdfApplication = (globalThis as any)['PDFViewerApplication']
        const pdfViewer = pdfApplication?.pdfViewer
        const pdfDocument: { fingerprint?: string; fingerprints?: string[] } =
            pdfViewer?.pdfDocument
        if (pdfDocument) {
            return pdfDocument
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
}

const getContentFingerprints: GetContentFingerprints = async () => {
    const pdfDocument = await waitForDocument()
    const fingerprintsStrings =
        pdfDocument.fingerprints ??
        (pdfDocument.fingerprint ? [pdfDocument.fingerprint] : [])
    const contentFingerprints = fingerprintsStrings
        .filter((fingerprint) => fingerprint != null)
        .map(
            (fingerprint): ContentFingerprint => ({
                fingerprintScheme: FingerprintSchemeType.PdfV1,
                fingerprint,
            }),
        )
    return contentFingerprints
}

Global.main({ loadRemotely: false, getContentFingerprints }).then(
    async (inPageUI) => {
        makeRemotelyCallableType<InPDFPageUIContentScriptRemoteInterface>({
            extractPDFContents: async () => {
                const searchParams = new URLSearchParams(location.search)
                const filePath = searchParams.get('file')

                if (!filePath?.length) {
                    return null
                }

                const pdf: PDFDocumentProxy = await (globalThis as any)[
                    'pdfjsLib'
                ].getDocument(filePath).promise
                return extractDataFromPDFDocument(pdf, document.title)
            },
        })
        await inPageUI.showSidebar()
    },
)
