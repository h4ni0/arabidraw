import { CODES, KEYS } from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import { presentationModeIcon } from "../components/icons";

import { register } from "./register";

export const actionTogglePresentationMode = register({
  name: "presentationMode",
  label: "buttons.presentationMode",
  icon: presentationModeIcon,
  viewMode: true,
  trackEvent: {
    category: "canvas",
    predicate: (appState) => !appState.presentationModeEnabled,
  },
  perform(elements, appState) {
    const entering = !this.checked!(appState);

    return {
      appState: {
        ...appState,
        presentationModeEnabled: entering,
        // Activate laser tool when entering, restore selection when exiting
        activeTool: entering
          ? {
              ...appState.activeTool,
              type: "laser" as const,
              customType: null,
              lastActiveTool: appState.activeTool,
            }
          : {
              ...appState.activeTool,
              type: "selection" as const,
              customType: null,
            },
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  checked: (appState) => appState.presentationModeEnabled,
  predicate: (elements, appState, appProps, app) => {
    return app.editorInterface.formFactor !== "phone";
  },
  keyTest: (event) =>
    !event[KEYS.CTRL_OR_CMD] && event.altKey && event.code === CODES.P,
});
