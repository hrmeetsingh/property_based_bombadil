// Bombadil specification for the onboarding form (web/).
//
// Bombadil opens the page in Chrome, performs random actions (clicks,
// typing, filling fields with good and bad values, submitting), and after
// every action checks that each exported property still holds. A property
// is a rule that must be true in *every* state, not one expected outcome
// for one scripted input.
//
// Run it with `make test-web`.

import { always, eventually, next, now } from "@antithesishq/bombadil";
import {
  actions,
  extract,
  getFingerprint,
  registerCustomAction,
  weighted,
} from "@antithesishq/bombadil/browser";
import { clicks, inputs } from "@antithesishq/bombadil/browser/defaults/actions";

// Default browser properties: no uncaught exceptions, no unhandled promise
// rejections, no console errors and no HTTP 4xx/5xx responses.
export {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults/properties";

// ---------------------------------------------------------------------------
// The validation rules, written independently of web/app.js. The spec is the
// oracle: if the app disagrees with these, a property fails.
// ---------------------------------------------------------------------------
type FieldName = "firstName" | "lastName" | "email" | "address";
const FIELDS: FieldName[] = ["firstName", "lastName", "email", "address"];

function isValidName(value: string): boolean {
  const v = value.trim();
  return v.length >= 1 && v.length <= 50 && /^\p{L}[\p{L}' -]*$/u.test(v);
}

const rules: Record<FieldName, (value: string) => boolean> = {
  firstName: isValidName,
  lastName: isValidName,
  email: (value) => {
    const v = value.trim();
    return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  },
  address: (value) => {
    const v = value.trim();
    return v.length >= 5 && v.length <= 200;
  },
};

// ---------------------------------------------------------------------------
// Extractors. Each one runs inside the page on every state Bombadil
// captures, so it must be self-contained and return plain JSON.
// ---------------------------------------------------------------------------

/** Value, touched flag and visible error text of every field. */
const fields = extract((state) => {
  const result: Record<string, { value: string; touched: boolean; error: string | null }> = {};
  for (const name of ["firstName", "lastName", "email", "address"]) {
    const input = state.document.getElementById(name) as HTMLInputElement | null;
    const error = state.document.getElementById(`${name}-error`);
    const text = error && !error.hidden ? (error.textContent ?? "").trim() : "";
    result[name] = {
      value: input?.value ?? "",
      touched: input?.dataset.touched === "true",
      error: text === "" ? null : text,
    };
  }
  return result;
});

/** The success summary, if visible: which submission, and what it shows. */
const success = extract((state) => {
  const panel = state.document.getElementById("success");
  if (!panel || panel.hidden) return null;
  const values: Record<string, string> = {};
  panel.querySelectorAll<HTMLElement>("[data-field]").forEach((dd) => {
    values[dd.dataset.field ?? ""] = dd.textContent ?? "";
  });
  return { submission: Number(panel.dataset.submission ?? 0), values };
});

/** Number of the latest successful submission (0 before the first). */
const submissionCount = extract((state) =>
  Number(state.document.getElementById("success")?.dataset.submission ?? 0),
);

/** Visible toasts, with their text and position. */
const toasts = extract((state) =>
  Array.from(state.document.querySelectorAll<HTMLElement>(".toast")).map((toast) => {
    const r = toast.getBoundingClientRect();
    return {
      id: toast.dataset.toastId ?? "",
      text: toast.textContent ?? "",
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    };
  }),
);

const viewport = extract((state) => ({
  width: state.window.innerWidth,
  height: state.window.innerHeight,
}));

/** Was the last action a click on the submit button? */
const clickedSubmit = extract((state) => {
  const action = state.lastAction;
  return (
    !!action &&
    typeof action === "object" &&
    "Click" in action &&
    action.Click.fingerprint.id === "submit"
  );
});

/** Where to click to submit, for the action generator below. */
const submitButton = extract((state) => {
  const button = state.document.getElementById("submit");
  if (!button) return null;
  const r = button.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return {
    fingerprint: getFingerprint(button),
    point: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
  };
});

const allValid = () => FIELDS.every((name) => rules[name](fields.current[name].value));

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

/**
 * Both directions: a touched field shows an error exactly when its value
 * breaks the rule, and an untouched field shows no error.
 */
export const errorShownIffInvalid = always(() =>
  FIELDS.every((name) => {
    const f = fields.current[name];
    const shouldShowError = f.touched && !rules[name](f.value);
    return (f.error !== null) === shouldShowError;
  }),
);

/** The success summary only ever shows values that pass every rule. */
export const successShowsOnlyValidValues = always(() => {
  const s = success.current;
  if (s === null) return true;
  return FIELDS.every((name) => rules[name](s.values[name] ?? ""));
});

/**
 * Clicking submit with every field valid leads, within 2 seconds, to a new
 * success summary and a toast naming the submitted email.
 */
export const validSubmitSucceeds = always(
  now(() => {
    if (!allValid()) return true;
    const before = submissionCount.current;
    const email = fields.current.email.value.trim();
    return next(() => clickedSubmit.current).implies(
      eventually(
        () =>
          submissionCount.current > before &&
          toasts.current.some((t) => t.text.includes(email)),
      ).within(2, "seconds"),
    );
  }),
);

/** Clicking submit with any invalid field never counts as a submission. */
export const invalidSubmitRejected = always(
  now(() => {
    if (allValid()) return true;
    const before = submissionCount.current;
    return next(() => !clickedSubmit.current || submissionCount.current === before);
  }),
);

/** Every toast sits in the top-right quarter of the viewport. */
export const toastInTopRight = always(() => {
  const { width, height } = viewport.current;
  return toasts.current.every(
    (t) => t.left >= width / 2 && t.right <= width && t.top >= 0 && t.bottom <= height / 2,
  );
});

/** Every toast goes away on its own within 5 seconds of being seen. */
export const toastDisappears = always(
  now(() => {
    const ids = toasts.current.map((t) => t.id);
    if (ids.length === 0) return true;
    return eventually(() => {
      const visible = toasts.current.map((t) => t.id);
      return ids.every((id) => !visible.includes(id));
    }).within(5, "seconds");
  }),
);

// ---------------------------------------------------------------------------
// Actions: what Bombadil may do, with weights. No reload or back/forward:
// a reload would remove a toast and hide a toast that never goes away.
// ---------------------------------------------------------------------------

/** Replace a field's value in one step, as if pasted. */
const fill = registerCustomAction("fill", async (document, _window, name: string, value: string) => {
  const input = document.getElementById(name) as HTMLInputElement | null;
  if (!input) throw new Error(`no field ${name}`);
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

const samples: Record<FieldName, { valid: string[]; invalid: string[] }> = {
  firstName: {
    valid: ["Ada", "Grace", "Mary-Jane", "Zoë", "Jean Luc"],
    invalid: ["", "   ", "R2D2", "Ada!", "A".repeat(51)],
  },
  lastName: {
    valid: ["Lovelace", "Hopper", "O'Brien", "Núñez", "van Dyke"],
    invalid: ["", "   ", "Smith3", "-Smith", "<b>Bold</b>"],
  },
  email: {
    valid: ["ada@example.com", "grace.hopper@navy.mil", "zoe+test@mail.co"],
    invalid: ["", "ada@", "@example.com", "ada@example", "ada lovelace@mail.com", "ada@@example.com"],
  },
  address: {
    valid: ["221B Baker Street, London", "1 Infinite Loop", "10 Downing St"],
    invalid: ["", "abc", "    "],
  },
};

const fillValid = actions(() =>
  FIELDS.flatMap((name) => samples[name].valid.map((value) => fill(name, value))),
);
const fillInvalid = actions(() =>
  FIELDS.flatMap((name) => samples[name].invalid.map((value) => fill(name, value))),
);
const clickSubmit = actions(() =>
  submitButton.current ? [{ Click: submitButton.current }] : [],
);

export const formActions = weighted([
  [6, fillValid],
  [2, fillInvalid],
  [3, clickSubmit],
  [2, inputs], // Bombadil's own random typing into inputs
  [1, clicks], // and random clicks anywhere
]);
