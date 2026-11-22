// Bombadil specification for the onboarding web form (browser driver).
//
// The properties below are the functional invariants of the form:
//
//   1. successRequiresValidData       - the success panel only ever shows up
//                                      when every field holds a valid value.
//   2. errorsOnlyShownForInvalidFields - a field error message is only ever
//                                      visible while that field is invalid.
//   3. toastIsTopRight                - whenever the toast is visible it
//                                      lives in the top-right quadrant.
//   4. toastEventuallyHides           - guarantee: every appearance of
//                                      the toast ends again (within 8s).
//   5. validSubmitShowsSuccess        - guarantee: submitting valid data
//                                      always brings up the success panel
//                                      and the toast (within 2s).
//   6. invalidSubmitShowsErrors       - submitting invalid data keeps the
//                                      form on screen and shows an error
//                                      for every invalid field.
//
// Properties 1-2 say "nothing wrong is shown"; 5-6 say "the right thing is
// shown". Without both directions a form that never reacts would pass.
//
// Plus the browser defaults re-exported below: no uncaught exceptions, no
// unhandled promise rejections, no console errors, no HTTP 4xx/5xx.
//
// Actions: Bombadil's default click/typing/scrolling generators, plus two
// custom actions that drive the interesting flows directly - submitting the
// form with valid, invalid-email, and empty values, and resetting after a
// successful submission.

import { always, now, eventually, actions, weighted } from "@antithesishq/bombadil";
import { registerCustomAction, extract } from "@antithesishq/bombadil/browser";
import {
  clicks,
  inputs,
  scroll,
} from "@antithesishq/bombadil/browser/defaults/actions";

// Browser defaults: no runtime errors, no failing network requests.
export {
  noUncaughtExceptions,
  noConsoleErrors,
  noUnhandledPromiseRejections,
  noHttpErrorCodes,
} from "@antithesishq/bombadil/browser/defaults/properties";

// The validation contract of the form, independent of the implementation:
// every field is required, the email field must look like an email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_IDS = ["first-name", "last-name", "email", "address"];

function isValidValue(id: string, raw: string): boolean {
  const value = raw.trim();
  if (value === "") return false;
  if (id === "email") return EMAIL_RE.test(value);
  return true;
}

// --- Custom actions --------------------------------------------------------

type SubmitMode = "valid" | "invalidEmail" | "empty";

const VALID_VALUES: Record<string, string> = {
  "first-name": "Ada",
  "last-name": "Lovelace",
  email: "ada@example.com",
  address: "12 Turing Lane",
};

const SUBMIT_VALUES: Record<SubmitMode, Record<string, string>> = {
  valid: VALID_VALUES,
  invalidEmail: { ...VALID_VALUES, email: "not-an-email" },
  empty: { "first-name": "", "last-name": "", email: "", address: "" },
};

// Fill the four fields with the values for `mode`, then submit.
const submitWith = registerCustomAction(
  "submitWith",
  async (document, _window, mode: SubmitMode) => {
    const values = SUBMIT_VALUES[mode];
    for (const id of FIELD_IDS) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) continue;
      el.value = values[id];
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const button = document.getElementById("submit-button") as HTMLButtonElement | null;
    button?.click();
  },
);

// Click "Register another person" on the success panel.
const resetRegistration = registerCustomAction("resetRegistration", async (document) => {
  const button = document.getElementById("reset-button") as HTMLButtonElement | null;
  button?.click();
});

// --- State extraction ------------------------------------------------------

const formVisible = extract(
  (state) => state.document.getElementById("onboarding-form")?.hidden === false,
);

const successVisible = extract(
  (state) => state.document.getElementById("success-panel")?.hidden === false,
);

const toastInfo = extract((state) => {
  const el = state.document.getElementById("toast");
  if (!el || el.hidden) return { visible: false, showing: "", top: 0, right: 0, vw: 0, vh: 0 };
  const rect = el.getBoundingClientRect();
  return {
    visible: true,
    // Which appearance this is (set by the app on every show).
    showing: el.dataset.showing ?? "",
    top: rect.top,
    right: rect.right,
    vw: state.window.innerWidth,
    vh: state.window.innerHeight,
  };
});

const fieldInfo = extract((state) =>
  FIELD_IDS.map((id) => {
    const el = state.document.getElementById(id) as HTMLInputElement | null;
    const error = state.document.querySelector(`[data-error-for="${id}"]`);
    if (!el) {
      // Page still loading: nothing to judge, show no errors.
      return { id, valid: true, errorVisible: false };
    }
    return {
      id,
      valid: isValidValue(id, el.value),
      errorVisible: error !== null && !error.hasAttribute("hidden"),
    };
  }),
);

// The mode of the submitWith action that produced the current state, or
// null when the last action was anything else.
const lastSubmitMode = extract((state): SubmitMode | null => {
  const action = state.lastAction;
  if (action === null || typeof action !== "object" || !("Custom" in action)) return null;
  if (action.Custom.name !== "submitWith") return null;
  // The 0.8 runtime records the arguments as `arguments`, while the type
  // definitions call them `args`; accept either.
  const custom = action.Custom as { args?: unknown[]; arguments?: unknown[] };
  const args = custom.arguments ?? custom.args ?? [];
  return (args[0] ?? null) as SubmitMode | null;
});

// --- Properties ------------------------------------------------------------

// 1. Whenever the success panel is visible, every field holds a value that
//    satisfies the form's validation contract.
export const successRequiresValidData = always(() => {
  if (!successVisible.current) return true;
  return fieldInfo.current.every((f) => f.valid);
});

// 2. A visible field error implies the field is currently invalid.
export const errorsOnlyShownForInvalidFields = always(() =>
  fieldInfo.current.every((f) => !f.errorVisible || !f.valid),
);

// 3. The toast is always rendered in the top-right corner of the viewport.
export const toastIsTopRight = always(() => {
  const toast = toastInfo.current;
  if (!toast.visible) return true;
  return toast.top >= 0 && toast.top < toast.vh / 2 && toast.right > toast.vw / 2;
});

// 4. Guarantee: every appearance of the toast ends within 8 seconds. The
//    toast may hide and reappear between two observed states, so "ends"
//    means hidden *or* replaced by a newer appearance (data-showing).
export const toastEventuallyHides = always(
  now(() => {
    const toast = toastInfo.current;
    if (!toast.visible) return true;
    const showing = toast.showing;
    return eventually(
      () => !toastInfo.current.visible || toastInfo.current.showing !== showing,
    ).within(8, "seconds");
  }),
);

// 5. Guarantee: a valid submission always leads to the success panel with
//    the toast on screen.
export const validSubmitShowsSuccess = always(
  now(() => lastSubmitMode.current === "valid").implies(
    eventually(() => successVisible.current && toastInfo.current.visible).within(2, "seconds"),
  ),
);

// 6. Right after an invalid submission the form is still on screen and
//    every invalid field shows its error message.
export const invalidSubmitShowsErrors = always(() => {
  const mode = lastSubmitMode.current;
  if (mode !== "invalidEmail" && mode !== "empty") return true;
  if (successVisible.current || !formVisible.current) return false;
  return fieldInfo.current.every((f) => f.valid || f.errorVisible);
});

// --- Action generators -----------------------------------------------------

// The three form submissions, only offered while the form is on screen.
const formActions = actions(() => {
  if (!formVisible.current) return [];
  return [submitWith("valid"), submitWith("invalidEmail"), submitWith("empty")];
});

// Resetting, only offered once the success panel is showing.
const resetAction = actions(() => {
  if (!successVisible.current) return [];
  return [resetRegistration()];
});

// Action note: the `reload` default generator is intentionally not used.
// A page reload resets the whole UI state (including the toast), which
// would silently satisfy the toastEventuallyHides guarantee without the
// app ever actually hiding the toast - masking exactly the bug that
// property exists to catch.
export const onboardingActions = weighted([
  [30, clicks],
  [30, inputs],
  [5, scroll],
  [12, formActions],
  [4, resetAction],
]);
