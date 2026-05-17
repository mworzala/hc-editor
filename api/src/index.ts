export {
    HCClient,
    HCV1Client,
    HCV1ProjectClient,
    HCV1ProjectFilesClient,
    canonicalHtu,
    type HCAuthHook,
    type HCClientLike,
    type HCClientOptions,
    type HCMethod,
    type HCRequestOptions,
} from './client'

export { HCClientProvider, useHCClient } from './provider'

export { ApiError, ApiErrorSchema, type ApiErrorBody } from './error'

export {
    encodeProjectId,
    encodeWildcardPath,
    projectEventsPath,
    projectFilePath,
    projectPath,
} from './path'

export { parseSSEStream, type SSEEvent } from './sse'

export {
    ProjectFileSchema,
    ProjectSchema,
    useV1ProjectGet,
    v1ProjectGet,
    v1ProjectGetKey,
    v1ProjectGetOptions,
    type Project,
    type ProjectFile,
    type UseV1ProjectGetOptions,
} from './endpoints/v1-project-get'

export {
    useV1ProjectFilesGet,
    v1ProjectFilesGet,
    v1ProjectFilesGetKey,
    v1ProjectFilesGetOptions,
    type ProjectFileBytes,
    type UseV1ProjectFilesGetOptions,
} from './endpoints/v1-project-files-get'

export {
    useV1ProjectFilesUpdate,
    v1ProjectFilesUpdate,
    v1ProjectFilesUpdateKey,
    type UseV1ProjectFilesUpdateOptions,
    type V1ProjectFilesUpdateVariables,
} from './endpoints/v1-project-files-update'

export {
    useV1ProjectFilesDelete,
    v1ProjectFilesDelete,
    v1ProjectFilesDeleteKey,
    type UseV1ProjectFilesDeleteOptions,
    type V1ProjectFilesDeleteVariables,
} from './endpoints/v1-project-files-delete'

export {
    ProjectEventSchema,
    v1ProjectEvents,
    type ProjectEvent,
    type ProjectEventEnvelope,
    type V1ProjectEventsOptions,
} from './endpoints/v1-project-events'

export {
    AccountMetaSchema,
    v1AuthRedeem,
    V1AuthRedeemResponseSchema,
    type AccountMeta,
    type ClientKind,
    type V1AuthRedeemRequest,
    type V1AuthRedeemResponse,
} from './endpoints/v1-auth-redeem'

export {
    v1AuthToken,
    V1AuthTokenResponseSchema,
    type V1AuthTokenRequest,
    type V1AuthTokenResponse,
} from './endpoints/v1-auth-token'
