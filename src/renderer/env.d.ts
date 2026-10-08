import type { AxonAPI } from "../shared/types";
declare global {
  interface Window {
    axon: AxonAPI;
  }
}
