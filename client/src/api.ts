// Typed RPC client. Types come straight from `server/src/actions.ts` — no
// codegen. `import type { Actions }` is type-only by design: the client
// bundle never pulls in any server runtime (SQLite, file APIs, etc.). With
// `verbatimModuleSyntax: true`, dropping `type` is a compile error.

import type { Actions } from "../../server/src/actions";
import { createActionClient } from "./rpc";

export const api = createActionClient<typeof Actions>();

// So client code can do
//
//     import { api, type ApiResponse } from "./api";
//     type Graph = ApiResponse<typeof api, "getGraph">["graph"];
export type { ApiRequest, ApiResponse } from "./rpc";
