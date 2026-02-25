import type { TypelessApi } from "./types";

declare global {
  interface Window {
    typelessApi: TypelessApi;
  }
}

export {};
