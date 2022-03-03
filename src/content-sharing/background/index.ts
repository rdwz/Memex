import pick from 'lodash/pick'
import type StorageManager from '@worldbrain/storex'
import type { StorageOperationEvent } from '@worldbrain/storex-middleware-change-watcher/lib/types'
import type { ContentSharingBackend } from '@worldbrain/memex-common/lib/content-sharing/backend'
import {
    makeAnnotationPrivacyLevel,
    getAnnotationPrivacyState,
    maybeGetAnnotationPrivacyState,
} from '@worldbrain/memex-common/lib/content-sharing/utils'
import type CustomListStorage from 'src/custom-lists/background/storage'
import type { AuthBackground } from 'src/authentication/background'
import type { Analytics } from 'src/analytics/types'
import {
    AnnotationPrivacyLevels,
    AnnotationPrivacyState,
} from '@worldbrain/memex-common/lib/annotations/types'
import { getNoteShareUrl } from 'src/content-sharing/utils'
import type { RemoteEventEmitter } from 'src/util/webextensionRPC'
import type ActivityStreamsBackground from 'src/activity-streams/background'
import type { Services } from 'src/services/types'
import type { ServerStorageModules } from 'src/storage/types'
import type {
    ContentSharingInterface,
    AnnotationSharingState,
    AnnotationSharingStates,
} from './types'
import { ContentSharingClientStorage } from './storage'
import type { GenerateServerID } from '../../background-script/types'
import AnnotationStorage from 'src/annotations/background/storage'
import { SharedListRoleID } from '@worldbrain/memex-common/lib/content-sharing/types'
import { AnnotListEntry, Annotation } from 'src/annotations/types'

export default class ContentSharingBackground {
    remoteFunctions: ContentSharingInterface
    storage: ContentSharingClientStorage

    _ensuredPages: { [normalizedUrl: string]: string } = {}

    constructor(
        public options: {
            storageManager: StorageManager
            backend: ContentSharingBackend
            customLists: CustomListStorage
            annotations: AnnotationStorage
            auth: AuthBackground
            analytics: Analytics
            activityStreams: Pick<ActivityStreamsBackground, 'backend'>
            services: Pick<Services, 'contentSharing'>
            captureException?: (e: Error) => void
            remoteEmitter: RemoteEventEmitter<'contentSharing'>
            getServerStorage: () => Promise<
                Pick<ServerStorageModules, 'contentSharing'>
            >
            generateServerId: GenerateServerID
        },
    ) {
        this.storage = new ContentSharingClientStorage({
            storageManager: options.storageManager,
        })

        this.remoteFunctions = {
            ...options.services.contentSharing,
            shareList: this.shareList,
            shareAnnotation: this.shareAnnotation,
            shareAnnotations: this.shareAnnotations,
            executePendingActions: this.executePendingActions.bind(this),
            shareAnnotationsToAllLists: this.shareAnnotationsToAllLists,
            unshareAnnotationsFromAllLists: this.unshareAnnotationsFromAllLists,
            shareAnnotationToSomeLists: this.shareAnnotationToSomeLists,
            unshareAnnotationFromSomeLists: this.unshareAnnotationFromSomeLists,
            unshareAnnotations: this.unshareAnnotations,
            ensureRemotePageId: this.ensureRemotePageId,
            getRemoteAnnotationLink: this.getRemoteAnnotationLink,
            findAnnotationPrivacyLevels: this.findAnnotationPrivacyLevels.bind(
                this,
            ),
            setAnnotationPrivacyLevel: this.setAnnotationPrivacyLevel,
            deleteAnnotationPrivacyLevel: this.deleteAnnotationPrivacyLevel,
            generateRemoteAnnotationId: async () =>
                this.generateRemoteAnnotationId(),
            getRemoteListId: async (callOptions) => {
                return this.storage.getRemoteListId({
                    localId: callOptions.localListId,
                })
            },
            getRemoteListIds: async (callOptions) => {
                return this.storage.getRemoteListIds({
                    localIds: callOptions.localListIds,
                })
            },
            getRemoteAnnotationIds: async (callOptions) => {
                return this.storage.getRemoteAnnotationIds({
                    localIds: callOptions.annotationUrls,
                })
            },
            getRemoteAnnotationMetadata: async (callOptions) => {
                return this.storage.getRemoteAnnotationMetadata({
                    localIds: callOptions.annotationUrls,
                })
            },
            areListsShared: async (callOptions) => {
                return this.storage.areListsShared({
                    localIds: callOptions.localListIds,
                })
            },
            getAnnotationSharingState: this.getAnnotationSharingState,
            getAnnotationSharingStates: this.getAnnotationSharingStates,
            getAllRemoteLists: this.getAllRemoteLists,
            waitForSync: this.waitForSync,
            suggestSharedLists: this.suggestSharedLists,
            unshareAnnotation: this.unshareAnnotation,
            deleteAnnotationShare: this.deleteAnnotationShare,
            canWriteToSharedListRemoteId: this.canWriteToSharedListRemoteId,
            canWriteToSharedList: this.canWriteToSharedList,
        }
    }

    async setup() {}

    async executePendingActions() {}

    private generateRemoteAnnotationId = (): string =>
        this.options.generateServerId('sharedAnnotation').toString()

    private getRemoteAnnotationLink: ContentSharingInterface['getRemoteAnnotationLink'] = async ({
        annotationUrl,
    }) => {
        const remoteIds = await this.storage.getRemoteAnnotationIds({
            localIds: [annotationUrl],
        })
        const remoteAnnotationId = remoteIds[annotationUrl]?.toString()

        if (remoteAnnotationId == null) {
            return null
        }

        return getNoteShareUrl({ remoteAnnotationId })
    }

    getAllRemoteLists: ContentSharingInterface['getAllRemoteLists'] = async () => {
        const remoteListIdsDict = await this.storage.getAllRemoteListIds()
        const remoteListData: Array<{
            localId: number
            remoteId: string
            name: string
        }> = []

        for (const localId of Object.keys(remoteListIdsDict).map(Number)) {
            const list = await this.options.customLists.fetchListById(localId)
            remoteListData.push({
                localId,
                remoteId: remoteListIdsDict[localId],
                name: list.name,
            })
        }

        return remoteListData
    }

    shareList: ContentSharingInterface['shareList'] = async (options) => {
        const existingRemoteId = await this.storage.getRemoteListId({
            localId: options.listId,
        })
        if (existingRemoteId) {
            return { remoteListId: existingRemoteId }
        }

        const localList = await this.options.customLists.fetchListById(
            options.listId,
        )
        if (!localList) {
            throw new Error(
                `Tried to share non-existing list: ID ${options.listId}`,
            )
        }

        const remoteListId = this.options
            .generateServerId('sharedList')
            .toString()
        await this.storage.storeListId({
            localId: options.listId,
            remoteId: remoteListId,
        })

        this.options.analytics.trackEvent({
            category: 'ContentSharing',
            action: 'shareList',
        })

        return {
            remoteListId,
        }
    }

    shareAnnotation: ContentSharingInterface['shareAnnotation'] = async (
        options,
    ) => {
        const sharingState = await this.getAnnotationSharingState(options)
        sharingState.hasLink = true
        if (!sharingState.remoteId) {
            sharingState.remoteId =
                options.remoteAnnotationId ?? this.generateRemoteAnnotationId()
            await this.storage.storeAnnotationMetadata([
                {
                    localId: options.annotationUrl,
                    excludeFromLists: !options.shareToLists ?? true,
                    remoteId: sharingState.remoteId,
                },
            ])
        }

        if (options.shareToLists) {
            const annotation = await this.options.annotations.getAnnotationByPk(
                options.annotationUrl,
            )
            sharingState.localListIds = await this.options.customLists.fetchListIdsByUrl(
                annotation.pageUrl,
            )
        } else {
            const annotationEntries = await this.options.annotations.findListEntriesByUrl(
                { url: options.annotationUrl },
            )
            sharingState.localListIds = annotationEntries.map(
                (entry) => entry.listId,
            )
        }

        if (!options.skipPrivacyLevelUpdate) {
            const privacyLevel = makeAnnotationPrivacyLevel({
                public: options.shareToLists,
                protected: options.setBulkShareProtected,
            })
            await this.storage.setAnnotationPrivacyLevel({
                annotation: options.annotationUrl,
                privacyLevel,
            })
            sharingState.privacyLevel = privacyLevel
        }

        this.options.analytics.trackEvent({
            category: 'ContentSharing',
            action: 'shareAnnotation',
        })

        return { remoteId: sharingState.remoteId, sharingState }
    }

    shareAnnotations: ContentSharingInterface['shareAnnotations'] = async (
        options,
    ) => {
        const remoteIds = await this.storage.getRemoteAnnotationIds({
            localIds: options.annotationUrls,
        })
        const annotPrivacyLevels = await this.storage.getPrivacyLevelsByAnnotation(
            { annotations: options.annotationUrls },
        )
        const nonProtectedAnnotations = options.annotationUrls.filter(
            (url) =>
                ![
                    AnnotationPrivacyLevels.PROTECTED,
                    AnnotationPrivacyLevels.SHARED_PROTECTED,
                ].includes(annotPrivacyLevels[url]?.privacyLevel),
        )

        await this.storage.storeAnnotationMetadata(
            nonProtectedAnnotations.map((localId) => ({
                localId,
                remoteId:
                    remoteIds[localId] ?? this.generateRemoteAnnotationId(),
                excludeFromLists: !options.shareToLists ?? true,
            })),
        )

        await this.storage.setAnnotationPrivacyLevelBulk({
            annotations: nonProtectedAnnotations,
            privacyLevel: makeAnnotationPrivacyLevel({
                public: options.shareToLists,
                protected: options.setBulkShareProtected,
            }),
        })

        return { sharingStates: await this.getAnnotationSharingStates(options) }
    }

    shareAnnotationsToAllLists: ContentSharingInterface['shareAnnotationsToAllLists'] = async (
        options,
    ) => {
        const allMetadata = await this.storage.getRemoteAnnotationMetadata({
            localIds: options.annotationUrls,
        })
        const nonPublicAnnotations = options.annotationUrls.filter(
            (url) => allMetadata[url]?.excludeFromLists,
        )
        await this.storage.setAnnotationsExcludedFromLists({
            localIds: nonPublicAnnotations,
            excludeFromLists: false,
        })
        await this.storage.setAnnotationPrivacyLevelBulk({
            annotations: nonPublicAnnotations,
            privacyLevel: AnnotationPrivacyLevels.SHARED,
        })

        return { sharingStates: await this.getAnnotationSharingStates(options) }
    }

    ensureRemotePageId: ContentSharingInterface['ensureRemotePageId'] = async (
        normalizedPageUrl,
    ) => {
        const userId = (await this.options.auth.authService.getCurrentUser())
            ?.id
        if (!userId) {
            throw new Error(
                `Tried to execute sharing action without being authenticated`,
            )
        }
        if (this._ensuredPages[normalizedPageUrl]) {
            return this._ensuredPages[normalizedPageUrl]
        }

        const userReference = {
            type: 'user-reference' as 'user-reference',
            id: userId,
        }

        const page = (
            await this.storage.getPages({
                normalizedPageUrls: [normalizedPageUrl],
            })
        )[normalizedPageUrl]
        const { contentSharing } = await this.options.getServerStorage()
        const reference = await contentSharing.ensurePageInfo({
            pageInfo: pick(page, 'fullTitle', 'originalUrl', 'normalizedUrl'),
            creatorReference: userReference,
        })
        const id = contentSharing.getSharedPageInfoLinkID(reference)
        this._ensuredPages[normalizedPageUrl] = id
        return id
    }

    unshareAnnotationsFromAllLists: ContentSharingInterface['unshareAnnotationsFromAllLists'] = async (
        options,
    ) => {
        const { annotations: annotationsBG } = this.options
        const privacyLevel = options.setBulkShareProtected
            ? AnnotationPrivacyLevels.PROTECTED
            : AnnotationPrivacyLevels.PRIVATE

        const sharingStates = await this.getAnnotationSharingStates({
            annotationUrls: options.annotationUrls,
        })

        for (const annotationUrl of options.annotationUrls) {
            if (sharingStates[annotationUrl] == null) {
                sharingStates[annotationUrl] = {
                    privacyLevel,
                    hasLink: false,
                    localListIds: [],
                }
                continue
            }

            // Remove annotation only from lists that are shared to
            let privateLists = []
            const localListIds = sharingStates[annotationUrl].localListIds

            if (localListIds.length) {
                const remoteListIds = await this.storage.getRemoteListIds({
                    localIds: localListIds,
                })

                for (const localListId of localListIds) {
                    if (remoteListIds[localListId] == null) {
                        privateLists.push(localListId)
                        continue
                    }
                    await annotationsBG.removeAnnotFromList({
                        url: annotationUrl,
                        listId: localListId,
                    })
                }
            }

            sharingStates[annotationUrl].localListIds = privateLists
            sharingStates[annotationUrl].privacyLevel = privacyLevel
        }

        const allMetadata = await this.storage.getRemoteAnnotationMetadata({
            localIds: options.annotationUrls,
        })
        await this.storage.setAnnotationsExcludedFromLists({
            localIds: options.annotationUrls.filter(
                (url) => !allMetadata[url]?.excludeFromLists,
            ),
            excludeFromLists: true,
        })
        await this.storage.setAnnotationPrivacyLevelBulk({
            annotations: options.annotationUrls,
            privacyLevel,
        })

        // As the annotation will be going from public (implicit list entries, following parent page) to private (explicit list entries),
        //  we need to ensure the remaining, non-shared lists entries exist in the DB
        const remainingEntries = await annotationsBG.findListEntriesByUrls({
            annotationUrls: options.annotationUrls,
        })
        for (const annotationUrl of options.annotationUrls) {
            const listEntryIds = new Set(
                remainingEntries[annotationUrl]?.map((e) => e.listId) ?? [],
            )
            const sharingState = sharingStates[annotationUrl]

            const missingListIds = sharingState.localListIds.filter(
                (listId) => !listEntryIds.has(listId),
            )
            for (const listId of missingListIds) {
                await annotationsBG.ensureAnnotInList({
                    listId,
                    url: annotationUrl,
                })
            }
        }

        return { sharingStates }
    }

    shareAnnotationToSomeLists: ContentSharingInterface['shareAnnotationToSomeLists'] = async (
        options,
    ) => {
        const {
            annotations: annotationsBG,
            customLists: customListsBG,
        } = this.options
        const [annotation, sharingState] = await Promise.all([
            annotationsBG.getAnnotationByPk(options.annotationUrl),
            this.getAnnotationSharingState(options),
        ])
        const pageListEntries = await customListsBG.fetchListIdsByUrl(
            annotation.pageUrl,
        )

        let otherPublicPageAnnotations = await annotationsBG.listAnnotationsByPageUrl(
            { pageUrl: annotation.pageUrl },
        )
        const privacyLevels = await this.findAnnotationPrivacyLevels({
            annotationUrls: otherPublicPageAnnotations.map((a) => a.url),
        })
        otherPublicPageAnnotations = otherPublicPageAnnotations.filter(
            (a) =>
                a.url !== options.annotationUrl &&
                maybeGetAnnotationPrivacyState(privacyLevels[a.url])?.public,
        )

        if (
            !getAnnotationPrivacyState(sharingState.privacyLevel).public ||
            options.protectAnnotation
        ) {
            sharingState.privacyLevel = AnnotationPrivacyLevels.PROTECTED
            await this.storage.setAnnotationPrivacyLevel({
                annotation: options.annotationUrl,
                privacyLevel: sharingState.privacyLevel,
            })
        }

        if (!sharingState.remoteId) {
            const { remoteId } = await this.shareAnnotation({
                annotationUrl: options.annotationUrl,
                skipPrivacyLevelUpdate: true,
            })
            sharingState.remoteId = remoteId
            sharingState.hasLink = true
        }

        const page = await this.storage.getPage(annotation.pageUrl)

        for (const listId of options.localListIds) {
            if (sharingState.localListIds.includes(listId)) {
                continue
            }
            if (!pageListEntries.includes(listId) && page != null) {
                await customListsBG.insertPageToList({
                    listId,
                    pageUrl: annotation.pageUrl,
                    fullUrl: page.originalUrl,
                })
            }
            await annotationsBG.insertAnnotToList({
                listId,
                url: options.annotationUrl,
            })
            for (const annot of otherPublicPageAnnotations) {
                await annotationsBG.ensureAnnotInList({
                    listId,
                    url: annot.url,
                })
            }

            sharingState.localListIds.push(listId)
        }
        return { sharingState }
    }

    unshareAnnotationFromSomeLists: ContentSharingInterface['unshareAnnotationFromSomeLists'] = async (
        options,
    ) => {
        const sharingState = await this.getAnnotationSharingState({
            annotationUrl: options.annotationUrl,
        })
        sharingState.localListIds = sharingState.localListIds.filter(
            (id) => !options.localListIds.includes(id),
        )

        const privacyState = getAnnotationPrivacyState(
            sharingState.privacyLevel,
        )
        if (privacyState.public) {
            for (const listId of sharingState.localListIds) {
                await this.options.annotations.insertAnnotToList({
                    listId,
                    url: options.annotationUrl,
                })
            }
        } else {
            for (const listId of options.localListIds) {
                await this.options.annotations.removeAnnotFromList({
                    listId,
                    url: options.annotationUrl,
                })
            }
        }
        await this.storage.setAnnotationPrivacyLevel({
            annotation: options.annotationUrl,
            privacyLevel: AnnotationPrivacyLevels.PROTECTED,
        })
        sharingState.privacyLevel = AnnotationPrivacyLevels.PROTECTED
        return { sharingState }
    }

    unshareAnnotations: ContentSharingInterface['unshareAnnotations'] = async (
        options,
    ) => {
        const annotPrivacyLevels = await this.storage.getPrivacyLevelsByAnnotation(
            { annotations: options.annotationUrls },
        )
        const nonProtectedAnnotations = options.annotationUrls.filter(
            (annotationUrl) =>
                ![
                    AnnotationPrivacyLevels.PROTECTED,
                    AnnotationPrivacyLevels.SHARED_PROTECTED,
                ].includes(annotPrivacyLevels[annotationUrl]?.privacyLevel),
        )

        const allMetadata = await this.storage.getRemoteAnnotationMetadata({
            localIds: nonProtectedAnnotations,
        })
        await this.storage.setAnnotationsExcludedFromLists({
            localIds: Object.values(allMetadata)
                .filter((metadata) => !metadata.excludeFromLists)
                .map(({ localId }) => localId),
            excludeFromLists: true,
        })

        await this.storage.setAnnotationPrivacyLevelBulk({
            annotations: nonProtectedAnnotations,
            privacyLevel: options.setBulkShareProtected
                ? AnnotationPrivacyLevels.PROTECTED
                : AnnotationPrivacyLevels.PRIVATE,
        })

        return { sharingStates: await this.getAnnotationSharingStates(options) }
    }

    unshareAnnotation: ContentSharingInterface['unshareAnnotation'] = async (
        options,
    ) => {
        const privacyLevelObject = await this.storage.findAnnotationPrivacyLevel(
            { annotation: options.annotationUrl },
        )
        let privacyLevel =
            privacyLevelObject?.privacyLevel ?? AnnotationPrivacyLevels.PRIVATE
        const privacyState = getAnnotationPrivacyState(privacyLevel)
        await this.storage.deleteAnnotationMetadata({
            localIds: [options.annotationUrl],
        })
        if (privacyState.public) {
            privacyLevel = AnnotationPrivacyLevels.PRIVATE
            await this.storage.setAnnotationPrivacyLevel({
                annotation: options.annotationUrl,
                privacyLevel,
            })
        }
        return {
            sharingState: { hasLink: false, localListIds: [], privacyLevel },
        }
    }

    deleteAnnotationShare: ContentSharingInterface['deleteAnnotationShare'] = async (
        options,
    ) => {
        await this.storage.deleteAnnotationMetadata({
            localIds: [options.annotationUrl],
        })
        await this.storage.deleteAnnotationPrivacyLevel({
            annotation: options.annotationUrl,
        })
    }

    findAnnotationPrivacyLevels: ContentSharingInterface['findAnnotationPrivacyLevels'] = async (
        params,
    ) => {
        const storedLevels = await this.storage.getPrivacyLevelsByAnnotation({
            annotations: params.annotationUrls,
        })

        const privacyLevels = {}
        for (const annotationUrl of params.annotationUrls) {
            privacyLevels[annotationUrl] =
                storedLevels[annotationUrl]?.privacyLevel ??
                AnnotationPrivacyLevels.PRIVATE
        }
        return privacyLevels
    }

    setAnnotationPrivacyLevel: ContentSharingInterface['setAnnotationPrivacyLevel'] = async (
        params,
    ) => {
        if (
            params.privacyLevel === AnnotationPrivacyLevels.SHARED ||
            params.privacyLevel === AnnotationPrivacyLevels.SHARED_PROTECTED
        ) {
            return this.shareAnnotation({
                annotationUrl: params.annotation,
                setBulkShareProtected:
                    params.privacyLevel ===
                    AnnotationPrivacyLevels.SHARED_PROTECTED,
                shareToLists: true,
            })
        } else if (params.keepListsIfUnsharing) {
            const sharingState = await this.getAnnotationSharingState({
                annotationUrl: params.annotation,
            })

            for (const listId of sharingState.localListIds) {
                await this.options.annotations.ensureAnnotInList({
                    listId,
                    url: params.annotation,
                })
            }
            await this.storage.setAnnotationsExcludedFromLists({
                localIds: [params.annotation],
                excludeFromLists: true,
            })

            sharingState.privacyLevel = AnnotationPrivacyLevels.PRIVATE
            await this.storage.setAnnotationPrivacyLevel({
                annotation: params.annotation,
                privacyLevel: AnnotationPrivacyLevels.PRIVATE,
            })

            return { sharingState }
        } else {
            const { sharingStates } = await this.unshareAnnotationsFromAllLists(
                {
                    annotationUrls: [params.annotation],
                    setBulkShareProtected:
                        params.privacyLevel ===
                        AnnotationPrivacyLevels.PROTECTED,
                },
            )
            return { sharingState: sharingStates[params.annotation] }
        }
    }

    deleteAnnotationPrivacyLevel: ContentSharingInterface['deleteAnnotationPrivacyLevel'] = async (
        params,
    ) => {
        await this.storage.deleteAnnotationPrivacyLevel(params)
    }

    waitForSync: ContentSharingInterface['waitForSync'] = async () => {}

    getAnnotationSharingState: ContentSharingInterface['getAnnotationSharingState'] = async (
        params,
    ) => {
        const {
            annotations: annotationsBG,
            customLists: customListsBG,
        } = this.options

        const privacyLevel = await this.storage.findAnnotationPrivacyLevel({
            annotation: params.annotationUrl,
        })
        const privacyState = maybeGetAnnotationPrivacyState(
            privacyLevel?.privacyLevel,
        )

        const [annotation, annotationEntries, remoteId] = await Promise.all<
            Annotation,
            AnnotListEntry[],
            string | number
        >([
            privacyState.public
                ? annotationsBG.getAnnotationByPk(params.annotationUrl)
                : Promise.resolve(null),
            privacyState.public
                ? Promise.resolve(null)
                : annotationsBG.findListEntriesByUrl({
                      url: params.annotationUrl,
                  }),
            this.storage.getRemoteAnnotationId({
                localId: params.annotationUrl,
            }),
        ])

        const localListIds = privacyState.public
            ? await customListsBG.fetchListIdsByUrl(annotation.pageUrl)
            : annotationEntries.map((entry) => entry.listId)

        return {
            localListIds,
            hasLink: !!remoteId,
            remoteId: remoteId ?? undefined,
            privacyLevel:
                privacyLevel?.privacyLevel ?? AnnotationPrivacyLevels.PRIVATE,
        }
    }

    getAnnotationSharingStates: ContentSharingInterface['getAnnotationSharingStates'] = async (
        params,
    ) => {
        const {
            annotations: annotationsBG,
            customLists: customListsBG,
        } = this.options

        // TODO: Optimize, this should only take 3 queries, not 3 * annotationCount
        const states: AnnotationSharingStates = {}

        const [privacyLevels, remoteIds] = await Promise.all([
            this.storage.getPrivacyLevelsByAnnotation({
                annotations: params.annotationUrls,
            }),
            this.storage.getRemoteAnnotationIds({
                localIds: params.annotationUrls,
            }),
        ])

        const privateAnnotationUrls = new Set<string>()
        const publicAnnotationUrls = new Set<string>()
        for (const annotationUrl in privacyLevels) {
            const privacyLevel = privacyLevels[annotationUrl]
            const privacyState = maybeGetAnnotationPrivacyState(
                privacyLevel?.privacyLevel,
            )

            if (privacyState.public) {
                publicAnnotationUrls.add(annotationUrl)
            } else {
                privateAnnotationUrls.add(annotationUrl)
            }
        }

        const [publicAnnotations, annotationEntries] = await Promise.all([
            annotationsBG.getAnnotations([...publicAnnotationUrls]),
            annotationsBG.findListEntriesByUrls(params),
        ])

        for (const annotationUrl of privateAnnotationUrls) {
            states[annotationUrl] = {
                remoteId: remoteIds[annotationUrl],
                hasLink: !!remoteIds[annotationUrl],
                localListIds:
                    annotationEntries[annotationUrl]?.map(
                        (entry) => entry.listId,
                    ) ?? [],
                privacyLevel:
                    privacyLevels[annotationUrl]?.privacyLevel ??
                    AnnotationPrivacyLevels.PRIVATE,
            }
        }

        const localListIdsByPageUrl = new Map<string, number[]>()
        for (const annotation of publicAnnotations) {
            let localListIds = localListIdsByPageUrl.get(annotation.pageUrl)

            // If not null, we've already processed another annotation with the same pageUrl
            if (localListIds == null) {
                localListIds = await customListsBG.fetchListIdsByUrl(
                    annotation.pageUrl,
                )
                localListIdsByPageUrl.set(annotation.pageUrl, localListIds)
            }

            states[annotation.url] = {
                remoteId: remoteIds[annotation.url],
                hasLink: !!remoteIds[annotation.url],
                localListIds,
                privacyLevel:
                    privacyLevels[annotation.url]?.privacyLevel ??
                    AnnotationPrivacyLevels.PRIVATE,
            }
        }

        return states
    }

    suggestSharedLists: ContentSharingInterface['suggestSharedLists'] = async (
        params,
    ) => {
        const loweredPrefix = params.prefix.toLowerCase()
        const lists = await this.options.customLists.fetchAllLists({
            limit: 10000,
            skip: 0,
        })
        const remoteIds = await this.storage.getAllRemoteListIds()
        const suggestions: Array<{
            localId: number
            name: string
            remoteId: string
            createdAt: number
        }> = []
        for (const list of lists) {
            if (
                remoteIds[list.id] &&
                list.name.toLowerCase().startsWith(loweredPrefix)
            ) {
                suggestions.push({
                    localId: list.id,
                    name: list.name,
                    remoteId: remoteIds[list.id],
                    createdAt: list.createdAt.getTime(),
                })
            }
        }
        return suggestions
    }

    canWriteToSharedListRemoteId: ContentSharingInterface['canWriteToSharedListRemoteId'] = async ({
        remoteId,
    }) => {
        // const remoteId = await this.storage.getRemoteListId({localId: params.localId,})
        const currentUser = await this.options.auth.authService.getCurrentUser()
        const storage = await this.options.getServerStorage()
        const listRole = await storage.contentSharing.getListRole({
            listReference: { type: 'shared-list-reference', id: remoteId },
            userReference: {
                type: 'user-reference',
                id: currentUser?.id,
            },
        })
        const canWrite = [
            SharedListRoleID.AddOnly,
            SharedListRoleID.ReadWrite,
            SharedListRoleID.Owner,
            SharedListRoleID.Admin,
        ].includes(listRole?.roleID)
        return canWrite
    }
    canWriteToSharedList: ContentSharingInterface['canWriteToSharedList'] = async (
        params,
    ) => {
        const remoteId = await this.storage.getRemoteListId({
            localId: params.localId,
        })
        return await this.canWriteToSharedListRemoteId({ remoteId })
    }

    async handlePostStorageChange(
        event: StorageOperationEvent<'post'>,
        options: {
            source: 'sync' | 'local'
        },
    ) {}
}
